import '@/global.css';
import '@/lib/i18n';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth/auth-context';
import i18n from '@/lib/i18n';
import { loadStoredLanguage } from '@/lib/prefs';

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Восстанавливаем язык до рендера маршрутов: при релоаде на /workouts экран-гейт
  // index не выполняется, поэтому язык нужно поднять здесь, иначе сбрасывается на en.
  const [langReady, setLangReady] = useState(false);
  useEffect(() => {
    loadStoredLanguage().then((lng) => {
      if (lng) i18n.changeLanguage(lng);
      setLangReady(true);
    });
  }, []);

  if (!langReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
