import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Регистрация Expo push-токена устройства в push_tokens (EAS этап 2, BACKLOG §9).
// Токен добывается и без пермишена на показ (он нужен только для отображения),
// поэтому зовём безусловно при старте — доставка включится, как только юзер разрешит.
// В Expo Go remote push вырезан (SDK 53+) и getExpoPushTokenAsync кидает — молча скипаем,
// там продолжает работать realtime-слой из entry-notifications.

export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const projectId: string | undefined =
      Constants.easConfig?.projectId ??
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    await supabase.from('push_tokens').upsert(
      { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );
  } catch {
    // Expo Go / эмулятор без Google-сервисов / нет сети — пуши недоступны, апка живёт дальше
  }
}
