import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  CATEGORY_ORDER,
  type Category,
  categoryKey,
  type Cluster,
  CLUSTER_ORDER,
  clusterKey,
  countExerciseUsage,
  deleteExercise,
  type Exercise,
  exerciseName,
  listExercises,
  listMyExercises,
  type Metric,
  replaceExercise,
  updateExercise,
} from '@/lib/db/exercises';
import i18n from '@/lib/i18n';

const PLACEHOLDER = '#848D9A';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-3 py-1.5 active:opacity-80"
      style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
    >
      <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function EditExercise({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [nameUk, setNameUk] = useState(exercise.name_uk);
  const [nameEn, setNameEn] = useState(exercise.name_en);
  const [cluster, setCluster] = useState<Cluster | null>(exercise.cluster);
  const [category, setCategory] = useState<Category | null>(exercise.category);
  const [metric, setMetric] = useState<Metric>(exercise.metric);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['my-exercises'] });
    qc.invalidateQueries({ queryKey: ['exercises-all'] });
    onClose();
  };

  const saveMut = useMutation({
    mutationFn: () =>
      updateExercise(exercise.id, {
        name_en: nameEn,
        name_uk: nameUk,
        cluster,
        category,
        metric,
      }),
    onSuccess: done,
  });

  const [delMode, setDelMode] = useState<'idle' | 'confirm' | 'inuse' | 'pick'>('idle');
  const [usage, setUsage] = useState(0);

  const doneReplace = () => {
    // ссылки в тренировках/программах перецеплены → освежаем эти кэши тоже
    qc.invalidateQueries({ queryKey: ['workouts'] });
    qc.invalidateQueries({ queryKey: ['programs'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
    done();
  };

  const delMut = useMutation({
    mutationFn: () => deleteExercise(exercise.id),
    onSuccess: done,
    onError: () => setDelMode('inuse'), // ссылка появилась между проверкой и удалением → предлагаем замену
  });
  const replaceMut = useMutation({
    mutationFn: (newId: string) => replaceExercise(exercise.id, newId),
    onSuccess: doneReplace,
  });

  // перед удалением считаем использование: если задействовано — предлагаем замену, а не тупик «не можна»
  const onDeletePress = async () => {
    try {
      const u = await countExerciseUsage(exercise.id);
      const total = u.workouts + u.programs;
      setUsage(total);
      setDelMode(total > 0 ? 'inuse' : 'confirm');
    } catch {
      setDelMode('confirm');
    }
  };

  return (
    <>
      <Text className="text-xl font-extrabold text-graphite-50">{t('exercises.editTitle')}</Text>

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('exercises.nameUk')}
          </Text>
          <TextInput
            value={nameUk}
            onChangeText={setNameUk}
            placeholderTextColor={PLACEHOLDER}
            className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('exercises.nameEn')}
          </Text>
          <TextInput
            value={nameEn}
            onChangeText={setNameEn}
            placeholderTextColor={PLACEHOLDER}
            className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />

          <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('exercises.cluster')}
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {CLUSTER_ORDER.map((c) => (
              <Chip key={c} label={t(clusterKey(c))} active={cluster === c} onPress={() => setCluster(c)} />
            ))}
            <Chip label={t('exercises.none')} active={cluster === null} onPress={() => setCluster(null)} />
          </View>

          <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('exercises.category')}
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {CATEGORY_ORDER.map((c) => (
              <Chip
                key={c}
                label={t(categoryKey(c))}
                active={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
            <Chip label={t('exercises.none')} active={category === null} onPress={() => setCategory(null)} />
          </View>

          <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('exercises.metric')}
          </Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            <Chip
              label={t('exercises.metricReps')}
              active={metric === 'reps'}
              onPress={() => setMetric('reps')}
            />
            <Chip
              label={t('exercises.metricTime')}
              active={metric === 'time'}
              onPress={() => setMetric('time')}
            />
          </View>

          <Pressable
            disabled={saveMut.isPending || nameUk.trim().length === 0}
            onPress={() => saveMut.mutate()}
            className="mt-6 items-center rounded-xl bg-accent py-3 active:opacity-80"
            style={{ opacity: nameUk.trim().length === 0 ? 0.5 : 1 }}
          >
            {saveMut.isPending ? (
              <ActivityIndicator color="#0C0E12" />
            ) : (
              <Text className="text-sm font-bold text-graphite-950">{t('exercises.save')}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={onDeletePress}
            disabled={delMut.isPending || replaceMut.isPending}
            className="mt-3 items-center py-2 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-red-400">
              {replaceMut.isPending ? t('exercises.replacing') : t('exercises.delete')}
            </Text>
          </Pressable>

      {/* простое удаление (не используется нигде) */}
      <ConfirmDialog
        visible={delMode === 'confirm'}
        title={t('exercises.deleteConfirm')}
        message={exercise.name_uk}
        confirmLabel={t('exercises.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setDelMode('idle');
          delMut.mutate();
        }}
        onCancel={() => setDelMode('idle')}
      />
      {/* используется → предлагаем замену вместо тупика */}
      <ConfirmDialog
        visible={delMode === 'inuse'}
        title={t('exercises.inUseTitle')}
        message={t('exercises.inUseBody', { count: usage })}
        confirmLabel={t('exercises.chooseReplacement')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => setDelMode('pick')}
        onCancel={() => setDelMode('idle')}
      />
      <ReplacePicker
        visible={delMode === 'pick'}
        excludeId={exercise.id}
        onPick={(newId) => {
          setDelMode('idle');
          replaceMut.mutate(newId);
        }}
        onClose={() => setDelMode('idle')}
      />
    </>
  );
}

/** Пикер замены: список упражнений (свои + каталог) с поиском, тематический. */
function ReplacePicker({
  visible,
  excludeId,
  onPick,
  onClose,
}: {
  visible: boolean;
  excludeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = i18n.language;
  const [q, setQ] = useState('');
  const { data: all } = useQuery({
    queryKey: ['exercises-all'],
    queryFn: listExercises,
    enabled: visible,
  });
  const needle = q.trim().toLowerCase();
  const list = (all ?? [])
    .filter((e) => e.id !== excludeId)
    .filter((e) => !needle || `${e.name_uk} ${e.name_en}`.toLowerCase().includes(needle))
    .slice(0, 60);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={onClose} />
        <View className="w-full self-center rounded-2xl bg-graphite-900 p-5" style={{ maxWidth: 420, maxHeight: '78%' }}>
          <Text className="text-lg font-bold text-graphite-50">{t('exercises.replacePickTitle')}</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('exercises.searchExercise')}
            placeholderTextColor={PLACEHOLDER}
            className="mt-3 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />
          <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
            {list.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => onPick(e.id)}
                className="mb-1.5 rounded-xl bg-graphite-800 px-4 py-3 active:opacity-80"
              >
                <Text className="text-sm font-semibold text-graphite-100">{exerciseName(e, lang)}</Text>
              </Pressable>
            ))}
            {list.length === 0 ? (
              <Text className="px-1 py-3 text-sm text-graphite-500">{t('exercises.empty')}</Text>
            ) : null}
          </ScrollView>
          <Pressable onPress={onClose} className="mt-2 items-center py-2 active:opacity-70">
            <Text className="text-sm font-semibold text-graphite-300">{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function ExercisesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const lang = i18n.language;
  const { session, initializing } = useAuth();
  const userId = session?.user.id;
  const [editing, setEditing] = useState<Exercise | null>(null);

  const { data: exercises, isLoading } = useQuery({
    queryKey: ['my-exercises', userId],
    queryFn: () => listMyExercises(userId as string),
    enabled: !!userId,
  });

  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50">{t('exercises.title')}</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#848D9A" />
        </View>
      ) : exercises && exercises.length > 0 ? (
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {exercises.map((ex) => (
            <Pressable
              key={ex.id}
              onPress={() => setEditing(ex)}
              className="mb-2 flex-row items-center justify-between rounded-2xl bg-graphite-900 p-4 active:opacity-80"
            >
              <View className="flex-1">
                <Text className="text-base font-semibold text-graphite-100">
                  {exerciseName(ex, lang)}
                </Text>
                <Text className="mt-0.5 text-xs text-graphite-500">
                  {t(clusterKey(ex.cluster))} · {t(categoryKey(ex.category))}
                </Text>
              </View>
              <Text className="ml-2 text-graphite-600">✎</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center px-10">
          <Text className="text-center text-sm leading-5 text-graphite-500">{t('exercises.empty')}</Text>
        </View>
      )}

      <BottomSheet visible={!!editing} onClose={() => setEditing(null)}>
        {editing && <EditExercise key={editing.id} exercise={editing} onClose={() => setEditing(null)} />}
      </BottomSheet>
    </SafeAreaView>
  );
}
