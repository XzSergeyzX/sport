import '@/global.css';
import '@/lib/i18n';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth/auth-context';
import i18n from '@/lib/i18n';
import { loadStoredLanguage } from '@/lib/prefs';
import { asyncPersister, queryClient } from '@/lib/query';
import { initWeightUnit } from '@/lib/use-unit';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Восстанавливаем язык до рендера маршрутов: при релоаде на /workouts экран-гейт
  // index не выполняется, поэтому язык нужно поднять здесь, иначе сбрасывается на en.
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    // Тёмный фон нативного рут-вью: иначе при переходах между экранами на миг
    // проступает белая «подложка» окна (мерцание). Делаем в рантайме — работает в Expo Go.
    SystemUI.setBackgroundColorAsync('#0C0E12');
    Promise.all([loadStoredLanguage(), initWeightUnit()]).then(([lng]) => {
      if (lng) i18n.changeLanguage(lng);
      setPrefsReady(true);
    });
  }, []);

  if (!prefsReady) return null;

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncPersister, maxAge: 1000 * 60 * 60 * 24 }}
      onSuccess={() => {
        // кэш восстановлен из персиста → доигрываем мутации, поставленные на паузу в оффлайне
        void queryClient.resumePausedMutations();
      }}
    >
      <SafeAreaProvider>
        <AuthProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0C0E12' },
            }}
          >
            {/* корневые экраны: свайп «назад» на index создавал бы redirect-петлю,
                поэтому отключаем жест */}
            <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
            <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          </Stack>
          <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        </AuthProvider>
      </SafeAreaProvider>
    </PersistQueryClientProvider>
  );
}
