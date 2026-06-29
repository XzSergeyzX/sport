import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

// Единая точка входа в настройки/аккаунт: «Акаунт» больше не таб (день-40),
// шестерёнка живёт в правом верхнем углу основных экранов.
export function SettingsButton() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push('/account')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('tabs.account')}
      className="active:opacity-60"
    >
      <Ionicons name="settings-outline" size={22} color="#848D9A" />
    </Pressable>
  );
}
