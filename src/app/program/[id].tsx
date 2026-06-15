import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { getProgramDetail, type ProgramSet, startWorkoutFromProgram } from '@/lib/db/programs';
import { formatWeight, useWeightUnit } from '@/lib/use-unit';

function setLine(s: ProgramSet, unit: 'kg' | 'lb', t: (k: string) => string): string {
  const parts: string[] = [];
  if (s.target_reps != null) parts.push(`${s.target_reps} ${t('workout.reps').toLowerCase()}`);
  // вес хранится в кг (канонически), показываем в выбранной единице с конвертацией
  if (s.target_weight != null) parts.push(`${formatWeight(s.target_weight, unit)} ${t(`common.${unit}`)}`);
  if (s.target_rpe != null) parts.push(`RPE ${s.target_rpe}`);
  if (s.rest_sec != null) parts.push(`${s.rest_sec}s ${t('workout.rest')}`);
  return parts.join(' · ') || '—';
}

export default function ProgramDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const { session, initializing } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => getProgramDetail(id),
    enabled: !!id && !!session,
  });

  const startMut = useMutation({
    mutationFn: () => startWorkoutFromProgram(session!.user.id, id, unit),
    onSuccess: (workoutId) => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      router.replace({ pathname: '/workout/[id]', params: { id: workoutId } });
    },
  });

  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50" numberOfLines={1}>
          {program?.title ?? t('programs.title')}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#848D9A" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {program?.program_exercises.map((pe) => (
            <View key={pe.id} className="mb-3 rounded-2xl bg-graphite-900 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-lg font-semibold text-graphite-100">{pe.name}</Text>
                {pe.exercise_id == null && (
                  <Text className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">
                    {t('programs.unmatched')}
                  </Text>
                )}
              </View>
              {pe.notes ? <Text className="mt-1 text-sm text-graphite-500">{pe.notes}</Text> : null}
              <View className="mt-3 gap-2">
                {pe.program_sets.map((s, i) => (
                  <View key={s.id} className="flex-row">
                    <Text className="w-6 text-sm text-graphite-600">{i + 1}</Text>
                    <Text className="flex-1 text-base text-graphite-300">{setLine(s, unit, t)}</Text>
                  </View>
                ))}
                {pe.program_sets.length === 0 && (
                  <Text className="text-base text-graphite-600">—</Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {!isLoading && program && program.program_exercises.length > 0 && (
        <View className="px-6 pb-6 pt-2">
          <Pressable
            disabled={startMut.isPending}
            onPress={() => startMut.mutate()}
            className="items-center rounded-2xl bg-accent py-4 active:opacity-80"
          >
            {startMut.isPending ? (
              <ActivityIndicator color="#0C0E12" />
            ) : (
              <Text className="text-base font-bold text-graphite-950">{t('home.start')}</Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
