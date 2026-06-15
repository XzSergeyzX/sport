import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { exerciseName } from '@/lib/db/exercises';
import { getWorkoutDetail, workoutStats } from '@/lib/db/workouts';
import i18n from '@/lib/i18n';
import { useWeightUnit } from '@/lib/use-unit';

function fmtRest(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-graphite-900 p-4">
      <Text className="text-2xl font-extrabold text-graphite-50">{value}</Text>
      <Text className="mt-1 text-xs uppercase tracking-wide text-graphite-500">{label}</Text>
    </View>
  );
}

export default function SummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = String(id);
  const { t } = useTranslation();
  const router = useRouter();
  const unit = useWeightUnit();
  const lang = i18n.language;
  const { session, initializing } = useAuth();

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
    enabled: !!session,
  });

  if (!initializing && !session) return <Redirect href="/auth" />;

  if (isLoading || !workout) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </SafeAreaView>
    );
  }

  const s = workoutStats(workout);
  const unitLabel = t(`common.${unit}`);

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24, gap: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-3xl font-extrabold text-graphite-50">{t('summary.crushed')}</Text>

        {/* Инфографика */}
        <View className="gap-3">
          <View className="flex-row gap-3">
            <Stat label={`${t('summary.tonnage')}, ${unitLabel}`} value={String(Math.round(s.tonnage))} />
            <Stat label={t('summary.exercises')} value={String(s.exercises)} />
          </View>
          <View className="flex-row gap-3">
            <Stat label={t('summary.sets')} value={String(s.sets)} />
            <Stat label={t('summary.reps')} value={String(s.reps)} />
          </View>
          {s.durationMin != null && (
            <Stat label={t('summary.duration')} value={`${s.durationMin} ${t('summary.min')}`} />
          )}
        </View>

        {/* Таблица сделанного */}
        <View className="gap-3">
          <Text className="text-sm font-semibold uppercase tracking-wide text-graphite-500">
            {t('summary.breakdown')}
          </Text>
          {workout.workout_exercises.map((we) => (
            <View key={we.id} className="rounded-2xl bg-graphite-900 p-4">
              <Text className="text-base font-bold text-graphite-50">
                {we.exercise ? exerciseName(we.exercise, lang) : '—'}
              </Text>
              <View className="mt-2 gap-1">
                {we.sets.map((set, i) => (
                  <View key={set.id} className="flex-row justify-between">
                    <Text className="text-sm text-graphite-400">
                      {t('workout.set')} {i + 1}
                    </Text>
                    <Text className="text-sm text-graphite-200">
                      {set.weight ?? '–'} {unitLabel} × {set.reps ?? '–'}
                      {set.rpe != null ? `  · RPE ${set.rpe}` : ''}
                      {set.rest_sec != null ? `  · ${fmtRest(set.rest_sec)}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="px-6 pb-6 pt-2">
        <Pressable
          onPress={() => router.replace('/workouts')}
          className="items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('summary.done')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
