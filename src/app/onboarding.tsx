import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type WeightUnit = 'kg' | 'lb';
type SegmentOption<T extends string> = { value: T; label: string };

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row rounded-2xl bg-graphite-800 p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            className={`flex-1 items-center rounded-xl py-3 ${selected ? 'bg-graphite-100' : ''}`}
          >
            <Text
              className={`text-base font-semibold ${selected ? 'text-graphite-950' : 'text-graphite-300'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();

  const [language, setLanguage] = useState<AppLanguage>(
    (i18n.language as AppLanguage) === 'uk' ? 'uk' : 'en',
  );
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [saving, setSaving] = useState(false);

  const onChangeLanguage = (next: AppLanguage) => {
    setLanguage(next);
    i18n.changeLanguage(next);
  };

  const onNext = async () => {
    setSaving(true);
    try {
      if (session?.user) {
        // best-effort: запись в профиль не должна блокировать переход
        try {
          await supabase.from('profile').upsert(
            {
              user_id: session.user.id,
              language,
              units: unit,
              onboarded_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
          );
        } catch {
          // игнорируем — локальный флаг ниже подстрахует
        }
      }
      await AsyncStorage.multiSet([
        ['app.language', language],
        ['app.weightUnit', unit],
        ['app.onboarded', 'true'],
      ]);
      router.replace('/home');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 justify-between px-6 py-8">
        <View className="gap-10">
          <View className="gap-2 pt-6">
            <Text className="text-3xl font-extrabold text-graphite-50">Sporty</Text>
            <Text className="text-base text-graphite-400">{t('onboarding.subtitle')}</Text>
          </View>

          <View className="gap-3">
            <Text className="text-lg font-semibold text-graphite-100">
              {t('onboarding.languageTitle')}
            </Text>
            <Segmented<AppLanguage>
              value={language}
              onChange={onChangeLanguage}
              options={[
                { value: 'en', label: t('common.english') },
                { value: 'uk', label: t('common.ukrainian') },
              ]}
            />
          </View>

          <View className="gap-3">
            <Text className="text-lg font-semibold text-graphite-100">
              {t('onboarding.weightTitle')}
            </Text>
            <Segmented<WeightUnit>
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'kg', label: t('common.kg') },
                { value: 'lb', label: t('common.lb') },
              ]}
            />
          </View>
        </View>

        <Pressable
          disabled={saving}
          onPress={onNext}
          className="items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
        >
          {saving ? (
            <ActivityIndicator color="#0C0E12" />
          ) : (
            <Text className="text-base font-bold text-graphite-950">{t('onboarding.next')}</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
