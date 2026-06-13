import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

// Гейт навигации:
//   нет сессии        → /auth
//   есть, без онбординга → /onboarding
//   иначе             → /home
export default function Index() {
  const { session, initializing } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('app.onboarded').then((value) => setOnboarded(value === 'true'));
  }, []);

  if (initializing || onboarded === null) {
    return (
      <View className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </View>
    );
  }

  if (!session) return <Redirect href="/auth" />;
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
