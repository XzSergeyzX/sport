import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import { deleteWorkout, listWorkouts, startWorkout, workoutStats } from '@/lib/db/workouts';

export default function WorkoutsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;

  const { data: workouts, isLoading } = useQuery({
    queryKey: ['workouts', userId],
    queryFn: () => listWorkouts(userId as string),
    enabled: !!userId,
  });

  const startMut = useMutation({
    mutationFn: () => startWorkout(userId as string),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ['workouts', userId] });
      router.push({ pathname: '/workout/[id]', params: { id: w.id } });
    },
  });

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const deleteMut = useMutation({
    mutationFn: (workoutId: string) => deleteWorkout(workoutId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts', userId] }),
  });

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('home.title')}</Text>

        <Pressable
          disabled={startMut.isPending}
          onPress={() => startMut.mutate()}
          className="mt-6 items-center rounded-2xl bg-accent py-4 active:opacity-80"
        >
          {startMut.isPending ? (
            <ActivityIndicator color="#0C0E12" />
          ) : (
            <Text className="text-base font-bold text-graphite-950">{t('home.start')}</Text>
          )}
        </Pressable>

        <Text className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-graphite-500">
          {t('home.recent')}
        </Text>

        {isLoading ? (
          <ActivityIndicator color="#848D9A" />
        ) : !workouts?.length ? (
          <Text className="text-base text-graphite-400">{t('home.empty')}</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 32 }}>
            {workouts.map((w) => {
              const s = workoutStats(w);
              const done = !!w.ended_at;
              const date = new Date(w.started_at).toLocaleDateString();
              return (
                <Pressable
                  key={w.id}
                  onPress={() =>
                    router.push(
                      done
                        ? { pathname: '/summary/[id]', params: { id: w.id } }
                        : { pathname: '/workout/[id]', params: { id: w.id } },
                    )
                  }
                  className="rounded-2xl bg-graphite-900 p-4 active:opacity-80"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-base font-semibold text-graphite-100">{date}</Text>
                    <View className="flex-row items-center gap-4">
                      {!done && (
                        <Text className="text-xs font-semibold text-accent">{t('home.inProgress')}</Text>
                      )}
                      <Pressable onPress={() => setPendingDelete(w.id)} hitSlop={10}>
                        <Text className="text-base text-graphite-600">🗑</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text className="mt-1 text-sm text-graphite-400">
                    {s.exercises} · {s.sets} {t('summary.sets').toLowerCase()} · {s.reps}{' '}
                    {t('summary.reps').toLowerCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <ConfirmDialog
        visible={!!pendingDelete}
        title={t('home.deleteTitle')}
        message={t('home.deleteWarn')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDelete) deleteMut.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}
