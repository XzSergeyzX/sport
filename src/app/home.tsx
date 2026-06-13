import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, signOut } = useAuth();

  const onSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 justify-between px-6 py-8">
        <View className="flex-1 items-center justify-center gap-3">
          <Text className="text-2xl font-extrabold text-graphite-50">
            {t('home.placeholderTitle')}
          </Text>
          <Text className="text-center text-base text-graphite-400">
            {t('home.placeholderBody')}
          </Text>
          {session?.user?.email && (
            <Text className="text-sm text-graphite-500">{session.user.email}</Text>
          )}
        </View>

        <Pressable
          onPress={onSignOut}
          className="items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-graphite-100">{t('home.signOut')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
