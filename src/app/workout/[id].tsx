import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  type KeyboardTypeOptions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { exerciseName, searchExercises } from '@/lib/db/exercises';
import {
  addSet,
  addWorkoutExercise,
  deleteSet,
  finishWorkout,
  getWorkoutDetail,
  type SetInput,
  type SetRow as SetRowType,
  updateSet,
} from '@/lib/db/workouts';
import i18n from '@/lib/i18n';
import { useWeightUnit, type WeightUnit } from '@/lib/use-unit';

const PLACEHOLDER = '#848D9A';

function fmt(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const { t } = useTranslation();
  const calc = () => Math.max(0, Math.floor((Date.now() - +new Date(startedAt)) / 1000));
  const [sec, setSec] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setSec(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);
  return (
    <Text className="text-sm text-graphite-400">
      {t('workout.elapsed')}: {fmt(sec)}
    </Text>
  );
}

function RestNow({ anchor }: { anchor: number | null }) {
  const { t } = useTranslation();
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!anchor) {
      setSec(0);
      return;
    }
    const tick = () => setSec(Math.max(0, Math.floor((Date.now() - anchor) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [anchor]);
  return (
    <View className="mt-3 rounded-2xl bg-graphite-900 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-graphite-400">{t('workout.restNow')}</Text>
        <Text className="text-lg font-bold text-accent">{anchor ? fmt(sec) : '—'}</Text>
      </View>
      <Text className="mt-1 text-xs text-graphite-600">{t('workout.restAuto')}</Text>
    </View>
  );
}

function SetRow({
  index,
  set,
  unit,
  onSave,
  onDelete,
}: {
  index: number;
  set: SetRowType;
  unit: WeightUnit;
  onSave: (id: string, input: SetInput) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');

  const save = () => {
    const repsN = parseNum(reps);
    onSave(set.id, {
      weight: parseNum(weight),
      reps: repsN === null ? null : Math.round(repsN),
      rpe: parseNum(rpe),
    });
  };

  const field = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    keyboardType: KeyboardTypeOptions = 'decimal-pad',
  ) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      onEndEditing={save}
      placeholder={placeholder}
      placeholderTextColor={PLACEHOLDER}
      keyboardType={keyboardType}
      className="flex-1 rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
    />
  );

  return (
    <View className="mt-2 rounded-xl bg-graphite-950/40 p-2">
      <View className="mb-1 flex-row items-center justify-between px-1">
        <Text className="text-xs text-graphite-500">
          {t('workout.set')} {index}
          {set.rest_sec != null ? `  ·  ${t('workout.rest')} ${fmt(set.rest_sec)}` : ''}
        </Text>
        <Pressable onPress={() => onDelete(set.id)} hitSlop={8}>
          <Text className="text-xs text-graphite-600">✕</Text>
        </Pressable>
      </View>
      <View className="flex-row items-center gap-2">
        {field(weight, setWeight, `${t('workout.weight')}, ${t(`common.${unit}`)}`)}
        {field(reps, setReps, t('workout.reps'), 'number-pad')}
        {field(rpe, setRpe, t('workout.rpe'))}
      </View>
    </View>
  );
}

function ExercisePicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (exerciseId: string) => void;
}) {
  const { t } = useTranslation();
  const lang = i18n.language;
  const [term, setTerm] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['exercise-search', term],
    queryFn: () => searchExercises(term),
    enabled: visible,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <SafeAreaView
          edges={['bottom']}
          className="rounded-t-3xl bg-graphite-900 px-5 pt-4"
          style={{ maxHeight: '80%' }}
        >
          <View className="flex-row items-center gap-3">
            <TextInput
              autoFocus
              value={term}
              onChangeText={setTerm}
              placeholder={t('workout.search')}
              placeholderTextColor={PLACEHOLDER}
              className="flex-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-graphite-400">{t('common.cancel')}</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            className="mt-3"
            contentContainerStyle={{ paddingBottom: 16 }}
          >
            {isFetching && <ActivityIndicator color="#848D9A" />}
            {!isFetching && data?.length === 0 && (
              <Text className="text-base text-graphite-400">{t('workout.noResults')}</Text>
            )}
            {data?.map((ex) => (
              <Pressable
                key={ex.id}
                onPress={() => onSelect(ex.id)}
                className="border-b border-graphite-800 py-3 active:opacity-70"
              >
                <Text className="text-base text-graphite-100">{exerciseName(ex, lang)}</Text>
                {ex.muscle_group && (
                  <Text className="text-xs text-graphite-500">{ex.muscle_group}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = String(id);
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const lang = i18n.language;
  const [pickerOpen, setPickerOpen] = useState(false);
  // момент последнего зафиксированного подхода (для авто-отдыха)
  const [anchor, setAnchor] = useState<number | null>(null);

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
  });

  // инициализируем якорь по последнему подходу (на случай перезахода в сессию)
  useEffect(() => {
    if (!workout) return;
    let max = 0;
    for (const we of workout.workout_exercises) {
      for (const s of we.sets) {
        const ts = +new Date(s.completed_at);
        if (ts > max) max = ts;
      }
    }
    setAnchor(max || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout?.id]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workout', workoutId] });

  const addExerciseMut = useMutation({
    mutationFn: (exerciseId: string) =>
      addWorkoutExercise(workoutId, exerciseId, workout?.workout_exercises.length ?? 0),
    onSuccess: () => {
      invalidate();
      setPickerOpen(false);
    },
  });

  const addSetMut = useMutation({
    mutationFn: (v: { weId: string; input: SetInput }) => addSet(v.weId, v.input),
    onSuccess: invalidate,
  });

  const updateSetMut = useMutation({
    mutationFn: (v: { id: string; input: SetInput }) => updateSet(v.id, v.input),
  });

  const deleteSetMut = useMutation({
    mutationFn: (setId: string) => deleteSet(setId),
    onSuccess: invalidate,
  });

  const finishMut = useMutation({
    mutationFn: () => finishWorkout(workoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      router.replace({ pathname: '/summary/[id]', params: { id: workoutId } });
    },
  });

  const onSetDone = (weId: string) => {
    const now = Date.now();
    const rest = anchor ? Math.round((now - anchor) / 1000) : null;
    addSetMut.mutate({ weId, input: { rest_sec: rest } });
    setAnchor(now);
  };

  if (isLoading || !workout) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 px-5 pt-3">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text className="text-2xl text-graphite-300">‹</Text>
          </Pressable>
          <Text className="text-lg font-bold text-graphite-50">{t('workout.title')}</Text>
          <Pressable disabled={finishMut.isPending} onPress={() => finishMut.mutate()} hitSlop={8}>
            <Text className="text-sm font-bold text-accent">{t('workout.finish')}</Text>
          </Pressable>
        </View>

        <ElapsedTimer startedAt={workout.started_at} />
        <RestNow anchor={anchor} />

        <ScrollView
          className="mt-4 flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {workout.workout_exercises.length === 0 && (
            <Text className="text-base text-graphite-400">{t('workout.noExercises')}</Text>
          )}
          {workout.workout_exercises.map((we) => (
            <View key={we.id} className="rounded-2xl bg-graphite-900 p-4">
              <Text className="text-base font-bold text-graphite-50">
                {we.exercise ? exerciseName(we.exercise, lang) : '—'}
              </Text>
              {we.sets.map((s, i) => (
                <SetRow
                  key={s.id}
                  index={i + 1}
                  set={s}
                  unit={unit}
                  onSave={(setId, input) => updateSetMut.mutate({ id: setId, input })}
                  onDelete={(setId) => deleteSetMut.mutate(setId)}
                />
              ))}
              <Pressable
                disabled={addSetMut.isPending}
                onPress={() => onSetDone(we.id)}
                className="mt-3 items-center rounded-xl bg-accent py-3 active:opacity-80"
              >
                <Text className="text-sm font-bold text-graphite-950">{t('workout.setDone')}</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <Pressable
          onPress={() => setPickerOpen(true)}
          className="mb-2 items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-graphite-100">{t('workout.addExercise')}</Text>
        </Pressable>
      </View>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(exerciseId) => addExerciseMut.mutate(exerciseId)}
      />
    </SafeAreaView>
  );
}
