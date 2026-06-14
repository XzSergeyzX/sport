import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

// Гейт навигации. Источник правды об онбординге — профиль в Supabase
// (синкается между устройствами). Локальный AsyncStorage — оффлайн-фолбэк.
export default function Index() {
  const { session, initializing } = useAuth();
  const [target, setTarget] = useState<'onboarding' | 'home' | null>(null);

  useEffect(() => {
    if (initializing || !session) return;
    let active = true;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('profile')
          .select('onboarded_at, language, units')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (error) throw error;
        if (!active) return;

        if (data?.language) {
          i18n.changeLanguage(data.language as AppLanguage);
          await AsyncStorage.setItem('app.language', data.language);
        }
        if (data?.units) await AsyncStorage.setItem('app.weightUnit', data.units);

        setTarget(data?.onboarded_at ? 'home' : 'onboarding');
      } catch {
        // БД недоступна / колонки ещё нет — падаем на локальный флаг
        const flag = await AsyncStorage.getItem('app.onboarded');
        if (active) setTarget(flag === 'true' ? 'home' : 'onboarding');
      }
    })();

    return () => {
      active = false;
    };
  }, [initializing, session]);

  if (initializing || (session && target === null)) {
    return (
      <View className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </View>
    );
  }

  if (!session) return <Redirect href="/auth" />;
  return <Redirect href={target === 'home' ? '/workouts' : '/onboarding'} />;
}
