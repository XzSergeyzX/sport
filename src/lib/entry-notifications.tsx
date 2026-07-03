import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';
import type { EntryStatus } from '@/lib/db/leaderboard';
import { supabase } from '@/lib/supabase';

// Нотификации в шторку о судьбе заявок лидерборда («схвалено/відхилено» + тап → борд).
// Remote push в Expo Go недоступен (SDK 53+), поэтому модель двухслойная:
//  1) пока апка жива (foreground/свёрнута) — realtime приносит UPDATE своей заявки сразу;
//  2) решение при закрытой апке — догоняется на старте сверкой статусов с последним
//     увиденным снимком в AsyncStorage (первый запуск только сеет снимок, без спама
//     историческими апрувами).
// expo-notifications не поддерживает web — импортируем динамически под Platform-гейтом,
// чтобы дев-смоук в браузере не падал.

const NOTIFIABLE: readonly EntryStatus[] = ['approved', 'rejected'];
const storageKey = (userId: string) => `lb-entry-status:${userId}`;

type StatusMap = Record<string, EntryStatus>;

export function EntryStatusNotifications() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let responseSub: { remove: () => void } | null = null;

    void (async () => {
      const Notifications = await import('expo-notifications');
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });

      // тап по нотификации → экран борда
      responseSub = Notifications.addNotificationResponseReceivedListener((resp) => {
        const data = resp.notification.request.content.data as { screen?: string } | null;
        if (data?.screen === 'leaderboard') router.push('/(tabs)/leaderboard');
      });

      if (Platform.OS === 'android') {
        // importance канала фиксируется при первом создании и потом не меняется —
        // старый 'leaderboard' (DEFAULT, к тому же не использовался из-за trigger: null
        // без channelId) сносим, живём на '-v2' с HIGH (иначе нет heads-up баннера)
        void Notifications.deleteNotificationChannelAsync('leaderboard');
        await Notifications.setNotificationChannelAsync('leaderboard-v2', {
          name: 'Leaderboard',
          importance: Notifications.AndroidImportance.HIGH,
        });
      }

      const ensurePermission = async (): Promise<boolean> => {
        const cur = await Notifications.getPermissionsAsync();
        if (cur.granted) return true;
        if (!cur.canAskAgain) return false;
        return (await Notifications.requestPermissionsAsync()).granted;
      };

      const notify = async (status: 'approved' | 'rejected') => {
        if (!(await ensurePermission())) return;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: t(status === 'approved' ? 'leaderboard.notifApprovedTitle' : 'leaderboard.notifRejectedTitle'),
            body: t(status === 'approved' ? 'leaderboard.notifApprovedBody' : 'leaderboard.notifRejectedBody'),
            data: { screen: 'leaderboard' },
          },
          // channelId обязателен: trigger: null уводит в фолбэк-канал expo (Miscellaneous)
          trigger: Platform.OS === 'android' ? { channelId: 'leaderboard-v2' } : null,
        });
      };

      // ---- догоняем решения, принятые при закрытой апке ----
      const { data: entries } = await supabase
        .from('leaderboard_entries')
        .select('id, status')
        .eq('user_id', userId);
      if (cancelled) return;
      if (entries) {
        const stored = await AsyncStorage.getItem(storageKey(userId));
        const prev: StatusMap | null = stored ? (JSON.parse(stored) as StatusMap) : null;
        const next: StatusMap = {};
        for (const row of entries) next[row.id as string] = row.status as EntryStatus;
        if (prev) {
          for (const [id, status] of Object.entries(next)) {
            // неизвестный id со статусом ≠ pending — заявка подана и рассмотрена, пока апка спала
            if (NOTIFIABLE.includes(status) && prev[id] !== status) {
              await notify(status as 'approved' | 'rejected');
            }
          }
        }
        await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
        if (entries.length > 0) void ensurePermission(); // спросить заранее, а не в момент апрува
      }

      // ---- realtime, пока апка жива (RLS: приходят только свои строки) ----
      if (cancelled) return;
      channel = supabase
        .channel(`lb-status-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'leaderboard_entries', filter: `user_id=eq.${userId}` },
          (payload) => {
            void (async () => {
              const row = payload.new as { id?: string; status?: EntryStatus };
              if (!row?.id || !row.status) return; // DELETE сюда не доходит (RLS-фильтр по user_id)
              const stored = await AsyncStorage.getItem(storageKey(userId));
              const map: StatusMap = stored ? (JSON.parse(stored) as StatusMap) : {};
              const was = map[row.id];
              map[row.id] = row.status;
              await AsyncStorage.setItem(storageKey(userId), JSON.stringify(map));
              if (payload.eventType === 'INSERT') {
                void ensurePermission(); // юзер только что подал заявку — уместный момент спросить
                return;
              }
              if (payload.eventType === 'UPDATE' && NOTIFIABLE.includes(row.status) && was !== row.status) {
                await notify(row.status as 'approved' | 'rejected');
                qc.invalidateQueries({ queryKey: ['leaderboard'] });
                qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
              }
            })();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      responseSub?.remove();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, qc, t, router]);

  return null;
}
