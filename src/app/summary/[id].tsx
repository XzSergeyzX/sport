import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { exerciseName } from '@/lib/db/exercises';
import { getWorkoutDetail, type WorkoutExercise, workoutStats } from '@/lib/db/workouts';
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

  // группируем детали по блокам (кластеры EMOM/E2MOM/суперсети — вместе, как в тренировке)
  type BGroup = { key: string; label: string | null; items: WorkoutExercise[] };
  const groups: BGroup[] = [];
  for (const we of workout.workout_exercises) {
    const last = groups[groups.length - 1];
    if (we.block_key && last && last.key === we.block_key) last.items.push(we);
    else if (we.block_key) groups.push({ key: we.block_key, label: we.block_label, items: [we] });
    else groups.push({ key: we.id, label: null, items: [we] });
  }

  // имя + строки подходов одного упражнения (используется и в одиночных, и внутри кластера)
  const exerciseRows = (we: WorkoutExercise) => (
    <View>
      <Text className="text-base font-bold text-graphite-50">
        {we.exercise ? exerciseName(we.exercise, lang) : (we.display_name ?? '—')}
      </Text>
      <View className="mt-2 gap-1">
        {we.sets.map((set, i) => {
          const done = !!set.logged_at;
          const m = (set.meta ?? {}) as { cheat?: boolean; side?: string };
          const tags =
            (m.side ? `  · ${t(`workout.side_${m.side}`)}` : '') +
            (m.cheat ? `  · ${t('workout.cheat')}` : '');
          return (
            <View
              key={set.id}
              className="flex-row justify-between"
              style={{ opacity: done ? 1 : 0.45 }}
            >
              <Text className="text-sm text-graphite-400">
                {t('workout.set')} {i + 1}
                {!done ? ` · ${t('workout.notDone')}` : ''}
              </Text>
              <Text className="text-sm text-graphite-200">
                {done
                  ? `${
                      set.duration_sec != null
                        ? `${set.weight != null ? `${set.weight} ${unitLabel} · ` : ''}${set.duration_sec}${t('workout.secShort')}`
                        : `${set.weight ?? '–'} ${unitLabel} × ${set.reps ?? '–'}`
                    }${set.rpe != null ? `  · RPE ${set.rpe}` : ''}${
                      set.rest_sec != null ? `  · ${fmtRest(set.rest_sec)}` : ''
                    }${tags}`
                  : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );

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
          {(s.durationMin != null || s.holdSec > 0) && (
            <View className="flex-row gap-3">
              {s.durationMin != null && (
                <Stat label={t('summary.duration')} value={`${s.durationMin} ${t('summary.min')}`} />
              )}
              {s.holdSec > 0 && <Stat label={t('summary.holdTime')} value={fmtRest(s.holdSec)} />}
            </View>
          )}
        </View>

        {/* Таблица сделанного */}
        <View className="gap-3">
          <Text className="text-sm font-semibold uppercase tracking-wide text-graphite-500">
            {t('summary.breakdown')}
          </Text>
          {groups.map((g) => {
            const isCluster = g.label != null || g.items.length > 1;
            return (
              <View key={g.key} className="rounded-2xl bg-graphite-900 p-4">
                {isCluster && (
                  <View className="mb-3 border-l-2 border-accent pl-3">
                    <Text className="text-sm font-extrabold uppercase tracking-wide text-accent">
                      {g.label || t('blockTypes.rounds')}
                    </Text>
                  </View>
                )}
                <View className="gap-4">
                  {g.items.map((we) => (
                    <View key={we.id}>{exerciseRows(we)}</View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="flex-row gap-3 px-6 pb-6 pt-2">
        <Pressable
          onPress={() => router.replace(`/workout/${workoutId}`)}
          className="flex-1 items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
        >
          <Text className="text-base font-bold text-graphite-100">{t('summary.edit')}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/workouts')}
          className="flex-1 items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('summary.done')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
