import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';
import type { EntryStatus } from '@/lib/db/leaderboard';
import { registerPushToken } from '@/lib/push-token';
import { supabase } from '@/lib/supabase';

// Нотификации в шторку о судьбе заявок лидерборда («схвалено/відхилено» + тап → борд).
// Remote push в Expo Go недоступен (SDK 53+), поэтому модель двухслойная:
//  1) пока апка жива (foreground/свёрнута) — realtime приносит UPDATE своей заявки сразу;
//  2) решение при закрытой/замороженной апке — догоняется сверкой статусов с последним
//     увиденным снимком в AsyncStorage: на старте И при каждом возврате в foreground
//     (Android замораживает JS в фоне — realtime-события теряются, сокет не реплеит;
//     первый запуск только сеет снимок, без спама историческими апрувами).
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
    let appStateSub: { remove: () => void } | null = null;

    void (async () => {
      const Notifications = await import('expo-notifications');
      if (cancelled) return;

      Notifications.setNotificationHandler({
        handleNotification: async (n) => {
          // remote push в foreground глушим: то же событие мгновенно покажет realtime-слой
          // (в фоне/убитой апке пуш постит система и до хендлера не доходит)
          const isRemote = (n.request.trigger as { type?: string } | null)?.type === 'push';
          return {
            shouldShowBanner: !isRemote,
            shouldShowList: !isRemote,
            shouldPlaySound: false,
            shouldSetBadge: false,
          };
        },
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

      const notify = async (status: 'approved' | 'rejected', entryId: string) => {
        if (!(await ensurePermission())) return;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: t(status === 'approved' ? 'leaderboard.notifApprovedTitle' : 'leaderboard.notifRejectedTitle'),
            body: t(status === 'approved' ? 'leaderboard.notifApprovedBody' : 'leaderboard.notifRejectedBody'),
            data: { screen: 'leaderboard', entryId, status },
          },
          // channelId обязателен: trigger: null уводит в фолбэк-канал expo (Miscellaneous)
          trigger: Platform.OS === 'android' ? { channelId: 'leaderboard-v2' } : null,
        });
      };

      // токен для remote push (EAS этап 2); в Expo Go тихо не сработает — и ок
      void registerPushToken(userId);

      // ---- догоняем решения, принятые пока апка спала (старт + возврат в foreground) ----
      let sweepRunning = false;
      const sweep = async (initial: boolean) => {
        if (sweepRunning) return; // не гоняться с самим собой при быстрых свернул/развернул
        sweepRunning = true;
        try {
          const { data: entries } = await supabase
            .from('leaderboard_entries')
            .select('id, status')
            .eq('user_id', userId);
          if (cancelled || !entries) return;
          const stored = await AsyncStorage.getItem(storageKey(userId));
          const prev: StatusMap | null = stored ? (JSON.parse(stored) as StatusMap) : null;
          const next: StatusMap = {};
          for (const row of entries) next[row.id as string] = row.status as EntryStatus;
          let changed = false;
          if (prev) {
            // если системный пуш об этом вердикте уже висит в шторке — локальный дубль не нужен
            const presented = await Notifications.getPresentedNotificationsAsync();
            const shown = new Set(
              presented.map((p) => {
                const d = p.request.content.data as { entryId?: string; status?: string } | null;
                return d?.entryId ? `${d.entryId}:${d.status ?? ''}` : '';
              }),
            );
            for (const [id, status] of Object.entries(next)) {
              // неизвестный id со статусом ≠ pending — заявка подана и рассмотрена, пока апка спала
              if (NOTIFIABLE.includes(status) && prev[id] !== status) {
                if (!shown.has(`${id}:${status}`)) {
                  await notify(status as 'approved' | 'rejected', id);
                }
                changed = true;
              }
            }
          }
          await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
          if (changed) {
            qc.invalidateQueries({ queryKey: ['leaderboard'] });
            qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
          }
          if (initial && entries.length > 0) void ensurePermission(); // спросить заранее, а не в момент апрува
        } finally {
          sweepRunning = false;
        }
      };
      await sweep(true);
      appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void sweep(false);
      });

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
                await notify(row.status as 'approved' | 'rejected', row.id);
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
      appStateSub?.remove();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, qc, t, router]);

  return null;
}
