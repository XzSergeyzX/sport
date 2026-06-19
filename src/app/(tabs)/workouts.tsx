import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  deleteWorkout,
  importPastWorkout,
  listWorkouts,
  startWorkout,
  workoutStats,
} from '@/lib/db/workouts';

const PLACEHOLDER = '#848D9A';
const IMPORT_ERROR_KEYS: Record<string, string> = {
  budget_exceeded: 'programs.errBudget',
  provider_unavailable: 'programs.errProvider',
  parse_failed: 'programs.errParse',
  no_exercises: 'programs.errParse',
  empty_input: 'programs.errEmpty',
};

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

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const importMut = useMutation({
    mutationFn: () => importPastWorkout(importText.trim()),
    onSuccess: (res) => {
      setImportText('');
      setImportOpen(false);
      setImportError(null);
      qc.invalidateQueries({ queryKey: ['workouts', userId] });
      router.push({ pathname: '/summary/[id]', params: { id: res.workout_id } });
    },
    onError: (e: Error) => {
      const key = IMPORT_ERROR_KEYS[e.message];
      setImportError(key ? t(key) : `${t('programs.errGeneric')} (${e.message})`);
    },
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

        {!importOpen ? (
          <Pressable
            onPress={() => setImportOpen(true)}
            className="mt-3 items-center rounded-2xl border border-graphite-700 py-3.5 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-graphite-200">{t('home.importCta')}</Text>
          </Pressable>
        ) : (
          <View className="mt-3 rounded-2xl bg-graphite-900 p-5">
            <Text className="text-base font-semibold text-graphite-100">{t('home.importTitle')}</Text>
            <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('home.importHint')}</Text>
            <TextInput
              value={importText}
              onChangeText={setImportText}
              placeholder={t('home.importPlaceholder')}
              placeholderTextColor={PLACEHOLDER}
              multiline
              textAlignVertical="top"
              className="mt-3 min-h-[140px] rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            {importError && <Text className="mt-2 text-sm text-red-400">{importError}</Text>}
            <View className="mt-3 flex-row gap-3">
              <Pressable
                onPress={() => {
                  setImportOpen(false);
                  setImportError(null);
                }}
                className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                <Text className="text-sm font-semibold text-graphite-200">{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={importMut.isPending || importText.trim().length < 3}
                onPress={() => importMut.mutate()}
                className="flex-1 items-center rounded-xl bg-accent py-3 active:opacity-80"
                style={{ opacity: importText.trim().length < 3 ? 0.5 : 1 }}
              >
                {importMut.isPending ? (
                  <ActivityIndicator color="#0C0E12" />
                ) : (
                  <Text className="text-sm font-bold text-graphite-950">{t('home.importGo')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

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
