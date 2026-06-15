import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

const ACTIVE = '#1FB89A';
const INACTIVE = '#5C6675';

function icon(glyph: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{glyph}</Text>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const { session, initializing } = useAuth();

  // Гард: на табы можно попасть прямым deep-link (скан QR), минуя гейт index.tsx.
  // Без сессии — выкидываем на вход, иначе экраны грузятся «без пользователя».
  if (initializing) {
    return (
      <View className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </View>
    );
  }
  if (!session) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#16191F',
          borderTopColor: '#23272F',
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="workouts"
        options={{ title: t('tabs.workouts'), tabBarIcon: icon('🏋️') }}
      />
      <Tabs.Screen
        name="programs"
        options={{ title: t('tabs.programs'), tabBarIcon: icon('📋') }}
      />
      <Tabs.Screen
        name="analytics"
        options={{ title: t('tabs.analytics'), tabBarIcon: icon('📈') }}
      />
      <Tabs.Screen name="health" options={{ title: t('tabs.health'), tabBarIcon: icon('❤️') }} />
      <Tabs.Screen name="account" options={{ title: t('tabs.account'), tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
