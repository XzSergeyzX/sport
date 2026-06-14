import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AnalyticsScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('analytics.title')}</Text>
        <View className="mt-6 rounded-2xl bg-graphite-900 p-5">
          <Text className="text-base font-semibold text-graphite-100">{t('analytics.soonTitle')}</Text>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('analytics.soonBody')}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
