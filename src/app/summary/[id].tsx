import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getWorkoutDetail, workoutStats } from '@/lib/db/workouts';
import { useWeightUnit } from '@/lib/use-unit';

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

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
  });

  if (isLoading || !workout) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </SafeAreaView>
    );
  }

  const s = workoutStats(workout);

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 justify-between px-6 py-8">
        <View className="gap-6">
          <Text className="text-3xl font-extrabold text-graphite-50">{t('summary.crushed')}</Text>

          <View className="gap-3">
            <View className="flex-row gap-3">
              <Stat
                label={`${t('summary.tonnage')}, ${t(`common.${unit}`)}`}
                value={String(Math.round(s.tonnage))}
              />
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
        </View>

        <Pressable
          onPress={() => router.replace('/home')}
          className="items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('summary.done')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
