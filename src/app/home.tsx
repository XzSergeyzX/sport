import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <Text className="text-2xl font-extrabold text-graphite-50">
          {t('home.placeholderTitle')}
        </Text>
        <Text className="text-center text-base text-graphite-400">
          {t('home.placeholderBody')}
        </Text>
      </View>
    </SafeAreaView>
  );
}
