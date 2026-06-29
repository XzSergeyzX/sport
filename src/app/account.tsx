import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Segmented } from '@/components/segmented';
import { useAuth } from '@/lib/auth/auth-context';
import { getTrackCycle, setTrackCycle } from '@/lib/db/cycle';
import {
  categoryKey,
  type Discipline,
  DISCIPLINES,
  getDisciplines,
  setDisciplines,
} from '@/lib/db/exercises';
import { type Gender, getGender, setGender } from '@/lib/db/profile';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { applyLanguage, applyUnit } from '@/lib/prefs';
import { useWeightUnit, type WeightUnit } from '@/lib/use-unit';

export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, initializing, signOut } = useAuth();
  const userId = session?.user.id;

  const { data: gender } = useQuery({
    queryKey: ['gender', userId],
    queryFn: () => getGender(userId as string),
    enabled: !!userId,
  });
  const genderMut = useMutation({
    mutationFn: (v: { g: Gender; self?: string | null }) => setGender(userId as string, v.g, v.self),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gender', userId] }),
  });
  const [genderSelf, setGenderSelf] = useState('');
  const [pendingSignOut, setPendingSignOut] = useState(false);

  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
  });
  const cycleMut = useMutation({
    mutationFn: (v: boolean) => setTrackCycle(userId as string, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-cycle', userId] }),
  });

  const GENDERS: Gender[] = ['male', 'female', 'other', 'na'];

  const { data: disciplines } = useQuery({
    queryKey: ['disciplines', userId],
    queryFn: () => getDisciplines(userId as string),
    enabled: !!userId,
  });
  const disciplinesMut = useMutation({
    mutationFn: (list: string[]) => setDisciplines(userId as string, list),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disciplines', userId] });
      qc.invalidateQueries({ queryKey: ['exercises-all'] });
    },
  });
  const toggleDiscipline = (d: Discipline) => {
    const cur = disciplines ?? [];
    disciplinesMut.mutate(cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]);
  };

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

  // self-guard: экран теперь вне (tabs), своего гейта сессии у него нет (как в exercises/grippers)
  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-graphite-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} hitSlop={10} className="pr-4 active:opacity-60">
            <Text className="text-2xl text-graphite-300">‹</Text>
          </Pressable>
          <Text className="flex-1 text-xl font-extrabold text-graphite-50">{t('account.title')}</Text>
        </View>
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

        <View className="mt-6 gap-2">
          <Text className="text-lg font-semibold text-graphite-100">{t('gender.title')}</Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {GENDERS.map((g) => {
              const active = gender?.gender === g;
              return (
                <Pressable
                  key={g}
                  onPress={() => genderMut.mutate({ g, self: genderSelf || gender?.self })}
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
          {gender?.gender === 'other' && (
            <TextInput
              value={genderSelf || (gender?.self ?? '')}
              onChangeText={setGenderSelf}
              onEndEditing={() => genderMut.mutate({ g: 'other', self: genderSelf })}
              placeholder={t('gender.custom')}
              placeholderTextColor="#848D9A"
              className="mt-1 rounded-xl bg-graphite-800 px-4 py-2.5 text-base text-graphite-50"
            />
          )}
        </View>

        {gender?.gender === 'female' && (
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
        )}

        <View className="mt-6 gap-2">
          <Text className="text-lg font-semibold text-graphite-100">{t('account.disciplines')}</Text>
          <Text className="text-sm text-graphite-500">{t('account.disciplinesHint')}</Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {DISCIPLINES.map((d) => {
              const active = (disciplines ?? []).includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDiscipline(d)}
                  className="rounded-full px-3 py-1.5 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                    {t(categoryKey(d))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/exercises')}
          className="mt-6 flex-row items-center justify-between active:opacity-70"
        >
          <Text className="text-lg font-semibold text-graphite-100">{t('account.myExercises')}</Text>
          <Text className="text-xl text-graphite-500">›</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/grippers')}
          className="mt-5 flex-row items-center justify-between active:opacity-70"
        >
          <Text className="text-lg font-semibold text-graphite-100">{t('account.myGrippers')}</Text>
          <Text className="text-xl text-graphite-500">›</Text>
        </Pressable>

        <Pressable
          onPress={() => setPendingSignOut(true)}
          className="mt-10 items-center rounded-2xl border border-red-900 py-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-red-400">{t('home.signOut')}</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={pendingSignOut}
        title={t('account.signOutConfirmTitle')}
        message={t('account.signOutConfirmMsg')}
        confirmLabel={t('home.signOut')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setPendingSignOut(false);
          void onSignOut();
        }}
        onCancel={() => setPendingSignOut(false)}
      />
    </SafeAreaView>
  );
}
