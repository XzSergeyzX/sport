import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import {
  getProgramDetail,
  groupProgram,
  type ProgramBlock,
  type ProgramSet,
  startWorkoutFromProgram,
} from '@/lib/db/programs';
import { repsLabel } from '@/lib/i18n/plural';
import { formatWeight, useWeightUnit } from '@/lib/use-unit';

function setLine(s: ProgramSet, unit: 'kg' | 'lb', t: (k: string) => string): string {
  const parts: string[] = [];
  if (s.target_reps != null) parts.push(repsLabel(s.target_reps));
  if (s.target_duration_sec != null) parts.push(`${s.target_duration_sec}${t('workout.secShort')}`);
  // вес хранится в кг (канонически), показываем в выбранной единице с конвертацией
  if (s.target_weight != null) parts.push(`${formatWeight(s.target_weight, unit)} ${t(`common.${unit}`)}`);
  if (s.target_rpe != null) parts.push(`RPE ${s.target_rpe}`);
  if (s.rest_sec != null) parts.push(`${s.rest_sec}s ${t('workout.rest')}`);
  if (s.notes) parts.push(s.notes);
  return parts.join(' · ') || '—';
}

// Подзаголовок блока: круги/интервал/отдых, если заданы.
function blockMeta(b: ProgramBlock, t: (k: string) => string): string {
  const parts: string[] = [];
  if (b.rounds != null) parts.push(`${b.rounds}×`);
  if (b.interval_sec != null) parts.push(`${Math.round(b.interval_sec / 60)} ${t('summary.min')}/коло`);
  if (b.duration_sec != null) parts.push(`${Math.round(b.duration_sec / 60)} ${t('summary.min')}`);
  if (b.rest_sec != null) parts.push(`${t('workout.rest')} ${b.rest_sec}s`);
  return parts.join(' · ');
}

export default function ProgramDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const insets = useSafeAreaInsets();
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
      <View className="flex-row items-start px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 pt-0.5 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50">
          {program?.title ?? t('programs.title')}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#848D9A" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {program &&
            groupProgram(program).map((g, gi) => {
              const meta = g.block ? blockMeta(g.block, t) : '';
              const isCluster = !!g.block && (g.block.type !== 'single' || g.exercises.length > 1);
              return (
                <View
                  key={g.block?.id ?? g.exercises[0]?.id ?? gi}
                  className="mb-3 rounded-2xl bg-graphite-900 p-4"
                >
                  {isCluster && (
                    <View className="mb-3 border-l-2 border-accent pl-3">
                      <Text className="text-base font-extrabold uppercase tracking-wide text-accent">
                        {g.block?.label || t(`blockTypes.${g.block?.type ?? 'single'}`)}
                      </Text>
                      {meta ? <Text className="mt-0.5 text-xs text-graphite-400">{meta}</Text> : null}
                    </View>
                  )}

                  {g.exercises.map((pe, ei) => (
                    <View key={pe.id} className={ei > 0 ? 'mt-4' : ''}>
                      <View className="flex-row items-center justify-between">
                        <Text className="flex-1 text-lg font-semibold text-graphite-100">{pe.name}</Text>
                        {pe.exercise_id == null && (
                          <Text className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">
                            {t('programs.unmatched')}
                          </Text>
                        )}
                      </View>
                      {pe.notes ? (
                        <Text className="mt-1 text-sm text-graphite-500">{pe.notes}</Text>
                      ) : null}
                      <View className="mt-2 gap-2">
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
                </View>
              );
            })}
        </ScrollView>
      )}

      {!isLoading && program && program.program_exercises.length > 0 && (
        <View className="px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
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

      <Modal visible={startMut.isPending} transparent animationType="fade">
        <View
          className="flex-1 items-center justify-center px-10"
          style={{ backgroundColor: 'rgba(8,10,14,0.92)' }}
        >
          <ActivityIndicator size="large" color="#1FB89A" />
          <Text className="mt-5 text-lg font-extrabold text-graphite-50">
            {t('programs.loadingTitle')}
          </Text>
          <Text className="mt-2 text-center text-sm text-graphite-400">{t('programs.loadingSub')}</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
