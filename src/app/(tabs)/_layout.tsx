import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { getHealthRelevant } from '@/lib/db/profile';
import { useRole } from '@/lib/use-role';

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
  const insets = useSafeAreaInsets();
  // grip (комьюнити) видит урезанный набор табов. Пока роль не загружена (undefined —
  // только самый первый запуск, дальше кэш персистится) показываем полный набор:
  // реальный гейт ИИ — на сервере, спрятанные табы — только UX.
  const role = useRole();
  const grip = role === 'grip';
  // «Здоров'я» осмыслен только с OURA/циклом (у Маши) — остальным таб не показываем.
  // Пока не загружено — прячем (не мигать пустым табом у тех, кому он не нужен).
  const userId = session?.user.id;
  const { data: healthRelevant } = useQuery({
    queryKey: ['health-relevant', userId],
    queryFn: () => getHealthRelevant(userId as string),
    enabled: !!userId,
    staleTime: 1000 * 60 * 30,
  });

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
        // нижний инсет в отступ (а не впритык к системному бару Android) + сам бар тянется
        // под навбар тем же цветом → иконки «дышат», не выглядит как схлопнутая панель
        tabBarStyle: {
          backgroundColor: '#16191F',
          borderTopColor: '#23272F',
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        // только иконки (решение дня-46): подписи резались («Тренува…»), а 3–6 иконок
        // читаются сами; title остаётся — его читает screen-reader
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="workouts"
        options={{ title: t('tabs.workouts'), tabBarIcon: icon('barbell-outline') }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: t('tabs.programs'),
          tabBarIcon: icon('clipboard-outline'),
          href: grip ? null : undefined, // href:null прячет таб (expo-router), роут остаётся
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: t('tabs.coach'),
          tabBarIcon: icon('chatbubble-ellipses-outline'),
          tabBarHideOnKeyboard: true,
          href: grip ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{ title: t('tabs.analytics'), tabBarIcon: icon('stats-chart-outline') }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: t('tabs.health'),
          tabBarIcon: icon('heart-outline'),
          href: grip || !healthRelevant ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{ title: t('tabs.leaderboard'), tabBarIcon: icon('trophy-outline') }}
      />
    </Tabs>
  );
}
