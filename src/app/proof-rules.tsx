import { Redirect, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';

// Правила видео-пруфа для заявок лидерборда (stack-роут как account/moderation).
// Ссылка сюда — из формы подачи заявки; сами правила модерирует Сергей, тексты в i18n.

const RULE_KEYS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;

export default function ProofRulesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, initializing } = useAuth();

  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50">
          {t('proofRules.title')}
        </Text>
      </View>

      <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text className="text-sm leading-5 text-graphite-400">{t('proofRules.intro')}</Text>

        <View className="mt-4 rounded-2xl bg-graphite-900 p-4">
          {RULE_KEYS.map((k, i) => (
            <View key={k} className={`flex-row ${i > 0 ? 'mt-3' : ''}`}>
              <Text className="w-6 text-sm font-bold text-accent">{i + 1}.</Text>
              <Text className="flex-1 text-sm leading-5 text-graphite-200">
                {t(`proofRules.${k}`)}
              </Text>
            </View>
          ))}
        </View>

        <Text className="mt-4 text-xs leading-4 text-graphite-500">{t('proofRules.note')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
