import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SyncStatus } from '@/components/sync-status';
import { useAuth } from '@/lib/auth/auth-context';
import { WORKOUT_START } from '@/lib/db/workout-mutations';
import {
  buildEmptyWorkout,
  deleteWorkout,
  importPastWorkout,
  listWorkouts,
  type WorkoutDetail,
  workoutStats,
} from '@/lib/db/workouts';
import i18n from '@/lib/i18n';
import { pluralCount } from '@/lib/plural';
import { fromKg, useWeightUnit } from '@/lib/use-unit';

const PLACEHOLDER = '#848D9A';

// «21.06.26, сб» — спершу дата, потім (після коми) день тижня, мовою застосунку
function humanDate(iso: string, locale: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
  const wd = d.toLocaleDateString(locale, { weekday: 'short' });
  return `${date}, ${wd}`;
}
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

  // старт по mutationKey → переживает перезапуск; оптимистику кладём синхронно (как у старта из
  // программы) → оффлайн пустая тренировка открывается мгновенно и досинкивается на реконнекте
  const startMut = useMutation<void, Error, WorkoutDetail>({ mutationKey: WORKOUT_START });

  const onStart = () => {
    if (!userId) return;
    const workout = buildEmptyWorkout(userId);
    qc.setQueryData(['workout', workout.id], workout);
    qc.setQueryData<WorkoutDetail[]>(['workouts', userId], (old) =>
      old ? [workout, ...old] : [workout],
    );
    startMut.mutate(workout); // оффлайн — встанет в очередь и доиграется на реконнекте
    router.push({ pathname: '/workout/[id]', params: { id: workout.id } });
  };

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

  // ——— дані для шапки: пульс (останнє/цей тиждень) + активне тренування ———
  const lang = i18n.language;
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const unit = useWeightUnit();
  const unitLabel = t(`common.${unit}`);

  const list = workouts ?? [];
  const total = list.length;
  const active = list.find((w) => !w.ended_at); // незавершене тренування (підняти нагору)

  // понеділок поточного тижня (00:00) для зведення «цього тижня»
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekList = list.filter((w) => new Date(w.started_at) >= weekStart);
  const weekTonnage = weekList.reduce((n, w) => n + workoutStats(w).tonnage, 0);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('home.title')}</Text>

        <SyncStatus />

        {total > 0 && (
          <Text className="mt-2 text-sm text-graphite-400">
            {t('home.thisWeek')}: {pluralCount(t, lang, 'workouts', weekList.length)}
            {weekTonnage > 0 ? ` · ${Math.round(weekTonnage)} ${unitLabel}` : ''}
          </Text>
        )}

        {active && (
          <Pressable
            onPress={() => router.push({ pathname: '/workout/[id]', params: { id: active.id } })}
            className="mt-4 flex-row items-center justify-between rounded-2xl border border-accent bg-graphite-900 px-5 py-4 active:opacity-80"
          >
            <View>
              <Text className="text-base font-bold text-accent">{t('home.resume')}</Text>
              <Text className="mt-0.5 text-xs text-graphite-400">
                {humanDate(active.started_at, locale)}
              </Text>
            </View>
            <Text className="text-xl text-accent">▸</Text>
          </Pressable>
        )}

        <Pressable
          onPress={onStart}
          className="mt-4 items-center rounded-2xl bg-accent py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('home.start')}</Text>
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
            {list.map((w, idx) => {
              const s = workoutStats(w);
              const done = !!w.ended_at;
              const num = total - idx; // абсолютний номер тренування (свіжа = найбільший), стабільний поки ≤30
              const counts = [
                pluralCount(t, lang, 'exercises', s.exercises),
                pluralCount(t, lang, 'sets', s.sets),
                pluralCount(t, lang, 'reps', s.reps),
              ].join(' · ');
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
                    <Text className="flex-1 text-base font-semibold capitalize text-graphite-100">
                      <Text className="text-xs font-bold text-graphite-600">№{num}  </Text>
                      {humanDate(w.started_at, locale)}
                    </Text>
                    <View className="flex-row items-center gap-3">
                      {!done && (
                        <Text className="text-xs font-semibold text-accent">{t('home.inProgress')}</Text>
                      )}
                      <Pressable onPress={() => setPendingDelete(w.id)} hitSlop={10}>
                        <Text className="text-base" style={{ opacity: 0.35 }}>🗑</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text className="mt-1 text-sm text-graphite-400">{counts}</Text>
                  {s.tonnage > 0 && (
                    <Text className="mt-0.5 text-sm text-graphite-500">
                      {Math.round(fromKg(s.tonnage, unit) ?? 0)} {unitLabel}
                    </Text>
                  )}
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
