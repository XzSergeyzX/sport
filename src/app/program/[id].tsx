import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getProgramDetail, type ProgramSet } from '@/lib/db/programs';
import { useWeightUnit } from '@/lib/use-unit';

function setLine(s: ProgramSet, unit: string, t: (k: string) => string): string {
  const parts: string[] = [];
  if (s.target_reps != null) parts.push(`${s.target_reps} ${t('workout.reps').toLowerCase()}`);
  if (s.target_weight != null) parts.push(`${s.target_weight} ${unit}`);
  if (s.target_rpe != null) parts.push(`RPE ${s.target_rpe}`);
  if (s.rest_sec != null) parts.push(`${s.rest_sec}s ${t('workout.rest')}`);
  return parts.join(' · ') || '—';
}

export default function ProgramDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const unit = useWeightUnit();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => getProgramDetail(id),
    enabled: !!id,
  });

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
                <Text className="flex-1 text-base font-semibold text-graphite-100">{pe.name}</Text>
                {pe.exercise_id == null && (
                  <Text className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">
                    {t('programs.unmatched')}
                  </Text>
                )}
              </View>
              {pe.notes ? <Text className="mt-1 text-xs text-graphite-500">{pe.notes}</Text> : null}
              <View className="mt-3 gap-1.5">
                {pe.program_sets.map((s, i) => (
                  <View key={s.id} className="flex-row">
                    <Text className="w-6 text-xs text-graphite-600">{i + 1}</Text>
                    <Text className="flex-1 text-sm text-graphite-300">{setLine(s, unit, t)}</Text>
                  </View>
                ))}
                {pe.program_sets.length === 0 && (
                  <Text className="text-sm text-graphite-600">—</Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
