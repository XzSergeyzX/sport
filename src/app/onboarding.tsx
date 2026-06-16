import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { useAuth } from '@/lib/auth/auth-context';
import { type Gender } from '@/lib/db/profile';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { setWeightUnit, type WeightUnit } from '@/lib/use-unit';

const GENDERS: Gender[] = ['male', 'female', 'other', 'na'];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();

  const [language, setLanguage] = useState<AppLanguage>(
    (i18n.language as AppLanguage) === 'uk' ? 'uk' : 'en',
  );
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [gender, setGender] = useState<Gender | null>(null);
  const [genderSelf, setGenderSelf] = useState('');
  const [cycle, setCycle] = useState(false);
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
              gender,
              gender_self: gender === 'other' ? genderSelf.trim() || null : null,
              track_cycle: gender === 'female' ? cycle : false,
              onboarded_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
          );
        } catch {
          // игнорируем — локальный флаг ниже подстрахует
        }
      }
      setWeightUnit(unit); // обновляет реактивный стор + AsyncStorage
      await AsyncStorage.multiSet([
        ['app.language', language],
        ['app.onboarded', 'true'],
      ]);
      router.replace('/workouts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 py-8">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ gap: 36, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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

          <View className="gap-3">
            <Text className="text-lg font-semibold text-graphite-100">{t('gender.title')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {GENDERS.map((g) => {
                const active = gender === g;
                return (
                  <Pressable
                    key={g}
                    onPress={() => setGender(g)}
                    className="rounded-full px-3 py-1.5 active:opacity-80"
                    style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                  >
                    <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                      {t(`gender.${g}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {gender === 'other' && (
              <TextInput
                value={genderSelf}
                onChangeText={setGenderSelf}
                placeholder={t('gender.custom')}
                placeholderTextColor="#848D9A"
                className="rounded-xl bg-graphite-800 px-4 py-2.5 text-base text-graphite-50"
              />
            )}
            {gender === 'female' && (
              <View className="mt-1 flex-row items-center justify-between">
                <Text className="flex-1 pr-4 text-sm text-graphite-300">{t('account.trackCycle')}</Text>
                <Switch
                  value={cycle}
                  onValueChange={setCycle}
                  trackColor={{ true: '#1FB89A', false: '#3A3F49' }}
                  thumbColor="#E5E7EB"
                />
              </View>
            )}
          </View>
        </ScrollView>

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
