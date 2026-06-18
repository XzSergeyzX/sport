import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/lib/auth/auth-context';
import {
  addProgramSet,
  deleteProgram,
  deleteProgramExercise,
  deleteProgramSet,
  getProgramDetail,
  groupProgram,
  isClusterBlock,
  type ProgramBlock,
  type ProgramSet,
  reorderProgramExercises,
  startWorkoutFromProgram,
  updateProgram,
  updateProgramExercise,
  updateProgramSet,
} from '@/lib/db/programs';
import { repsLabel } from '@/lib/i18n/plural';
import { formatWeight, fromKg, toKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';

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

function num(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

type SetPatch = {
  target_reps?: number | null;
  target_weight?: number | null;
  target_duration_sec?: number | null;
};

function EditableName({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onEndEditing={() => {
        const v = draft.trim();
        if (v && v !== name) onSave(v);
      }}
      multiline
      className="flex-1 rounded-lg bg-graphite-800 px-3 py-2 text-lg font-semibold text-graphite-50"
    />
  );
}

function EditableSet({
  index,
  set,
  unit,
  onSave,
  onDelete,
}: {
  index: number;
  set: ProgramSet;
  unit: WeightUnit;
  onSave: (id: string, patch: SetPatch) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isTime = set.target_duration_sec != null;
  const [weight, setWeight] = useState(
    set.target_weight != null ? String(Math.round((fromKg(set.target_weight, unit) ?? 0) * 10) / 10) : '',
  );
  const [reps, setReps] = useState(set.target_reps != null ? String(set.target_reps) : '');
  const [secs, setSecs] = useState(set.target_duration_sec != null ? String(set.target_duration_sec) : '');

  const save = () => {
    const w = num(weight);
    onSave(set.id, {
      target_weight: w == null ? null : toKg(w, unit),
      ...(isTime
        ? { target_duration_sec: num(secs) == null ? null : Math.round(num(secs) as number) }
        : { target_reps: num(reps) == null ? null : Math.round(num(reps) as number) }),
    });
  };

  return (
    <View className="flex-row items-start gap-2">
      <Text className="w-5 pt-2 text-sm text-graphite-600">{index}</Text>
      <View className="flex-1">
        <TextInput
          value={weight}
          onChangeText={setWeight}
          onEndEditing={save}
          placeholder={t('workout.weight')}
          placeholderTextColor="#848D9A"
          keyboardType="decimal-pad"
          className="rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
        />
        <Text className="mt-0.5 text-center text-[10px] text-graphite-600">{t(`common.${unit}`)}</Text>
      </View>
      <View className="flex-1">
        <TextInput
          value={isTime ? secs : reps}
          onChangeText={isTime ? setSecs : setReps}
          onEndEditing={save}
          placeholder={isTime ? t('workout.secShort') : t('workout.reps')}
          placeholderTextColor="#848D9A"
          keyboardType="number-pad"
          className="rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
        />
        <Text className="mt-0.5 text-center text-[10px] text-graphite-600">
          {isTime ? t('workout.secShort') : t('workout.repsShort')}
        </Text>
      </View>
      <Pressable onPress={() => onDelete(set.id)} hitSlop={8} className="pt-2">
        <Text className="text-base text-red-400">✕</Text>
      </Pressable>
    </View>
  );
}

export default function ProgramDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const insets = useSafeAreaInsets();
  const { session, initializing } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editMode, setEditMode] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

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

  const renameMut = useMutation({
    mutationFn: (title: string) => updateProgram(id, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['program', id] });
      qc.invalidateQueries({ queryKey: ['programs'] });
    },
  });

  const delExMut = useMutation({
    mutationFn: (peId: string) => deleteProgramExercise(peId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['program', id] }),
  });

  const renameExMut = useMutation({
    mutationFn: (v: { peId: string; name: string }) => updateProgramExercise(v.peId, v.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['program', id] }),
  });

  const moveExMut = useMutation({
    mutationFn: (v: { ids: string[]; orders: number[] }) =>
      reorderProgramExercises(v.ids, v.orders),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['program', id] }),
  });
  // переставить упражнение среди «соседей» (тот же block_id) на dir (-1 вверх / +1 вниз)
  const moveExercise = (
    siblings: { id: string; order_index: number }[],
    si: number,
    dir: number,
  ) => {
    const target = si + dir;
    if (target < 0 || target >= siblings.length) return;
    const ids = siblings.map((e) => e.id);
    [ids[si], ids[target]] = [ids[target], ids[si]];
    // перенумеровываем 0..n-1 — устойчиво к дублям order_index из импорта
    moveExMut.mutate({ ids, orders: ids.map((_, k) => k) });
  };

  const delProgMut = useMutation({
    mutationFn: () => deleteProgram(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] });
      router.back();
    },
  });
  const [showDeleteProg, setShowDeleteProg] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['program', id] });
  const addSetMut = useMutation({
    mutationFn: (v: { peId: string; order: number }) => addProgramSet(v.peId, v.order),
    onSuccess: invalidate,
  });
  const updateSetMut = useMutation({
    mutationFn: (v: { id: string; patch: SetPatch }) => updateProgramSet(v.id, v.patch),
    onSuccess: invalidate,
  });
  const delSetMut = useMutation({
    mutationFn: (sid: string) => deleteProgramSet(sid),
    onSuccess: invalidate,
  });

  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-start border-b border-graphite-800 bg-graphite-950 px-6 pb-3 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 pt-0.5 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        {editMode ? (
          <TextInput
            value={titleDraft ?? program?.title ?? ''}
            onChangeText={setTitleDraft}
            onEndEditing={() => {
              const v = (titleDraft ?? '').trim();
              if (v && v !== program?.title) renameMut.mutate(v);
            }}
            className="flex-1 rounded-lg bg-graphite-800 px-3 py-1.5 text-xl font-extrabold text-graphite-50"
          />
        ) : (
          <Text className="flex-1 text-xl font-extrabold text-graphite-50">
            {program?.title ?? t('programs.title')}
          </Text>
        )}
        {program && (
          <Pressable
            onPress={() => {
              setTitleDraft(program.title);
              setEditMode((v) => !v);
            }}
            className="pl-3 pt-1 active:opacity-60"
          >
            <Text className="text-sm font-semibold text-accent">
              {editMode ? t('exercises.save') : t('programs.edit')}
            </Text>
          </Pressable>
        )}
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
              const isCluster = isClusterBlock(g.block);
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

                  {g.exercises.map((pe, ei) => {
                    // соседи для перестановки — упражнения с тем же block_id (внутри блока
                    // или все standalone-упражнения между собой), по возрастанию order_index
                    const siblings = program.program_exercises
                      .filter((p) => p.block_id === pe.block_id)
                      .sort((a, b) => a.order_index - b.order_index);
                    const si = siblings.findIndex((p) => p.id === pe.id);
                    return (
                    <View key={pe.id} className={ei > 0 ? 'mt-4' : ''}>
                      <View className="flex-row items-center justify-between">
                        {editMode ? (
                          <EditableName
                            key={pe.id}
                            name={pe.name}
                            onSave={(name) => renameExMut.mutate({ peId: pe.id, name })}
                          />
                        ) : (
                          <Text className="flex-1 text-lg font-semibold text-graphite-100">{pe.name}</Text>
                        )}
                        {!editMode && pe.exercise_id == null && (
                          <Text className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">
                            {t('programs.unmatched')}
                          </Text>
                        )}
                        {editMode && siblings.length > 1 && (
                          <View className="ml-2 flex-row gap-1">
                            <Pressable
                              disabled={si === 0}
                              onPress={() => moveExercise(siblings, si, -1)}
                              hitSlop={6}
                              className="px-1"
                              style={{ opacity: si === 0 ? 0.3 : 1 }}
                            >
                              <Text className="text-lg text-graphite-300">↑</Text>
                            </Pressable>
                            <Pressable
                              disabled={si === siblings.length - 1}
                              onPress={() => moveExercise(siblings, si, 1)}
                              hitSlop={6}
                              className="px-1"
                              style={{ opacity: si === siblings.length - 1 ? 0.3 : 1 }}
                            >
                              <Text className="text-lg text-graphite-300">↓</Text>
                            </Pressable>
                          </View>
                        )}
                        {editMode && (
                          <Pressable onPress={() => delExMut.mutate(pe.id)} hitSlop={8} className="ml-3">
                            <Text className="text-base text-red-400">✕</Text>
                          </Pressable>
                        )}
                      </View>
                      {pe.notes ? (
                        <Text className="mt-1 text-sm text-graphite-500">{pe.notes}</Text>
                      ) : null}
                      <View className="mt-2 gap-2">
                        {pe.program_sets.map((s, i) =>
                          editMode ? (
                            <EditableSet
                              key={s.id}
                              index={i + 1}
                              set={s}
                              unit={unit}
                              onSave={(sid, patch) => updateSetMut.mutate({ id: sid, patch })}
                              onDelete={(sid) => delSetMut.mutate(sid)}
                            />
                          ) : (
                            <View key={s.id} className="flex-row">
                              <Text className="w-6 text-sm text-graphite-600">{i + 1}</Text>
                              <Text className="flex-1 text-base text-graphite-300">{setLine(s, unit, t)}</Text>
                            </View>
                          ),
                        )}
                        {editMode ? (
                          <Pressable
                            onPress={() => addSetMut.mutate({ peId: pe.id, order: pe.program_sets.length })}
                            className="mt-1 self-start rounded-lg border border-graphite-700 px-3 py-1.5 active:opacity-70"
                          >
                            <Text className="text-xs font-semibold text-graphite-200">{t('workout.addSet')}</Text>
                          </Pressable>
                        ) : (
                          pe.program_sets.length === 0 && (
                            <Text className="text-base text-graphite-600">—</Text>
                          )
                        )}
                      </View>
                    </View>
                    );
                  })}
                </View>
              );
            })}
        </ScrollView>
      )}

      {!isLoading && program && (
        <View className="px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
          {editMode ? (
            <Pressable
              onPress={() => setShowDeleteProg(true)}
              className="items-center rounded-2xl border border-red-500/40 py-4 active:opacity-70"
            >
              <Text className="text-base font-bold text-red-400">{t('programs.deleteProgram')}</Text>
            </Pressable>
          ) : (
            program.program_exercises.length > 0 && (
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
            )
          )}
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

      <ConfirmDialog
        visible={showDeleteProg}
        title={t('programs.deleteTitle')}
        message={t('programs.deleteWarn')}
        confirmLabel={t('programs.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setShowDeleteProg(false);
          delProgMut.mutate();
        }}
        onCancel={() => setShowDeleteProg(false)}
      />
    </SafeAreaView>
  );
}
