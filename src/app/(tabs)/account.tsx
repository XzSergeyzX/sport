import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { useAuth } from '@/lib/auth/auth-context';
import { getTrackCycle, setTrackCycle } from '@/lib/db/cycle';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { applyLanguage, applyUnit } from '@/lib/prefs';
import { useWeightUnit, type WeightUnit } from '@/lib/use-unit';

export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, signOut } = useAuth();
  const userId = session?.user.id;

  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
  });
  const cycleMut = useMutation({
    mutationFn: (v: boolean) => setTrackCycle(userId as string, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-cycle', userId] }),
  });

  const [language, setLanguage] = useState<AppLanguage>(
    (i18n.language as AppLanguage) === 'uk' ? 'uk' : 'en',
  );
  const unit = useWeightUnit();

  const onChangeLanguage = (next: AppLanguage) => {
    setLanguage(next);
    void applyLanguage(next, userId);
  };

  const onChangeUnit = (next: WeightUnit) => {
    void applyUnit(next, userId);
  };

  const onSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('account.title')}</Text>
        {session?.user.email && (
          <Text className="mt-1 text-sm text-graphite-400">{session.user.email}</Text>
        )}

        <View className="mt-8 gap-3">
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

        <View className="mt-6 gap-3">
          <Text className="text-lg font-semibold text-graphite-100">
            {t('onboarding.weightTitle')}
          </Text>
          <Segmented<WeightUnit>
            value={unit}
            onChange={onChangeUnit}
            options={[
              { value: 'kg', label: t('common.kg') },
              { value: 'lb', label: t('common.lb') },
            ]}
          />
        </View>

        <View className="mt-6 flex-row items-center justify-between">
          <View className="flex-1 pr-4">
            <Text className="text-lg font-semibold text-graphite-100">{t('account.trackCycle')}</Text>
            <Text className="mt-0.5 text-sm text-graphite-500">{t('account.trackCycleHint')}</Text>
          </View>
          <Switch
            value={!!trackCycle}
            onValueChange={(v) => cycleMut.mutate(v)}
            trackColor={{ true: '#1FB89A', false: '#3A3F49' }}
            thumbColor="#E5E7EB"
          />
        </View>

        <View className="flex-1" />

        <Pressable
          onPress={onSignOut}
          className="mb-6 items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-graphite-300">{t('home.signOut')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
