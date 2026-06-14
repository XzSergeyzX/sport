import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HealthScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('health.title')}</Text>

        {/* OURA — опционально, не у всех есть кольцо. Подключение здесь, карточкой. */}
        <View className="mt-6 rounded-2xl bg-graphite-900 p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-graphite-100">{t('health.ouraTitle')}</Text>
            <Text className="text-xs uppercase tracking-wide text-graphite-500">
              {t('health.optional')}
            </Text>
          </View>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.ouraBody')}</Text>
          <Pressable
            disabled
            className="mt-4 items-center rounded-xl border border-graphite-700 py-3 opacity-50"
          >
            <Text className="text-sm font-semibold text-graphite-300">{t('health.connectOura')}</Text>
          </Pressable>
        </View>

        <View className="mt-4 rounded-2xl bg-graphite-900 p-5">
          <Text className="text-base font-semibold text-graphite-100">{t('health.soonTitle')}</Text>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.soonBody')}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
