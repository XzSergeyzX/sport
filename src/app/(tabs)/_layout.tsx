import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

const ACTIVE = '#1FB89A';
const INACTIVE = '#5C6675';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
// Единый набор Ionicons (outline) вместо эмодзи: красятся active/inactive-цветом
// (эмодзи tint игнорировали) и согласованы между собой.
function icon(name: IoniconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size ?? 22} color={color} />
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
        options={{ title: t('tabs.workouts'), tabBarIcon: icon('barbell-outline') }}
      />
      <Tabs.Screen
        name="programs"
        options={{ title: t('tabs.programs'), tabBarIcon: icon('clipboard-outline') }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: t('tabs.coach'),
          tabBarIcon: icon('chatbubble-ellipses-outline'),
          tabBarHideOnKeyboard: true,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{ title: t('tabs.analytics'), tabBarIcon: icon('stats-chart-outline') }}
      />
      <Tabs.Screen
        name="health"
        options={{ title: t('tabs.health'), tabBarIcon: icon('heart-outline') }}
      />
    </Tabs>
  );
}
