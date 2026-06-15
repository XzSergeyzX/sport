import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  type KeyboardTypeOptions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  categoryKey,
  clusterKey,
  createCustomExercise,
  exerciseName,
  groupByCluster,
  listExercises,
  matchExercise,
} from '@/lib/db/exercises';
import {
  addSet,
  addWorkoutExercise,
  deleteSet,
  finishWorkout,
  getRecentExercises,
  getWorkoutDetail,
  type SetInput,
  type SetRow as SetRowType,
  setExerciseDone,
  setSetLogged,
  updateSet,
  type WorkoutExercise,
} from '@/lib/db/workouts';
import { useAuth } from '@/lib/auth/auth-context';
import i18n from '@/lib/i18n';
import { setsLabel } from '@/lib/i18n/plural';
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

// ---- RPE: зоны усилия (1–4 легко, 5–7 средне, 8–10 тяжело) ----
type RpeZone = 'low' | 'medium' | 'hard';
const RPE_ZONES: { zone: RpeZone; values: number[]; color: string }[] = [
  { zone: 'low', values: [1, 2, 3, 4], color: '#34D399' },
  { zone: 'medium', values: [5, 6, 7], color: '#FBBF24' },
  { zone: 'hard', values: [8, 9, 10], color: '#F87171' },
];

function rpeColor(rpe: number | null): string | null {
  if (rpe == null) return null;
  return RPE_ZONES.find((z) => z.values.includes(Math.round(rpe)))?.color ?? null;
}

function RpePicker({
  visible,
  value,
  onClose,
  onSelect,
}: {
  visible: boolean;
  value: number | null;
  onClose: () => void;
  onSelect: (rpe: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose}>
        <Pressable onPress={() => {}} className="rounded-t-3xl bg-graphite-900 px-5 pb-8 pt-4">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-bold text-graphite-50">{t('workout.rpePrompt')}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-graphite-400">{t('common.cancel')}</Text>
            </Pressable>
          </View>
          {RPE_ZONES.map((z) => (
            <View key={z.zone} className="mb-4">
              <View className="mb-1 flex-row items-center gap-2">
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: z.color }} />
                <Text className="text-sm font-semibold text-graphite-100">{t(`rpeZones.${z.zone}`)}</Text>
                <Text className="text-xs text-graphite-500">· {t(`rpeHints.${z.zone}`)}</Text>
              </View>
              <View className="flex-row gap-2">
                {z.values.map((n) => {
                  const active = value === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => onSelect(n)}
                      className="h-12 flex-1 items-center justify-center rounded-xl active:opacity-80"
                      style={{ backgroundColor: active ? z.color : 'rgba(255,255,255,0.06)' }}
                    >
                      <Text
                        className="text-base font-bold"
                        style={{ color: active ? '#0B0F14' : '#E5E7EB' }}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => onSelect(null)}
            className="mt-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
          >
            <Text className="text-sm text-graphite-300">{t('workout.rpeClear')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
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

// Минутный таймер EMOM/E2MOM — «как факт»: показывает текущий интервал и сколько осталось.
function EmomTimer({ intervalSec }: { intervalSec: number }) {
  const { t } = useTranslation();
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = start != null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const elapsed = running ? Math.max(0, Math.floor((now - start!) / 1000)) : 0;
  const interval = Math.floor(elapsed / intervalSec) + 1;
  const left = intervalSec - (elapsed % intervalSec);
  return (
    <View className="mb-3 flex-row items-center justify-between rounded-xl bg-graphite-800 px-3 py-2">
      <Text className="text-xs text-graphite-400">
        {running ? `${t('workout.interval')} ${interval} · ${left}s` : t('workout.emomHint')}
      </Text>
      <View className="flex-row items-center gap-3">
        {running && <Text className="text-sm font-bold text-accent">{fmt(elapsed)}</Text>}
        <Pressable
          onPress={() => {
            if (running) setStart(null);
            else {
              setNow(Date.now());
              setStart(Date.now());
            }
          }}
          hitSlop={6}
        >
          <Text className="text-sm font-bold text-accent">
            {running ? t('workout.stopTimer') : t('workout.startTimer')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SetRow({
  index,
  set,
  unit,
  onSave,
  onToggleDone,
  onDelete,
  headerLabel,
}: {
  index: number;
  set: SetRowType;
  unit: WeightUnit;
  onSave: (id: string, input: SetInput) => void;
  onToggleDone: (set: SetRowType) => void;
  onDelete: (id: string) => void;
  headerLabel?: string;
}) {
  const { t } = useTranslation();
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState<number | null>(set.rpe ?? null);
  const [rpeOpen, setRpeOpen] = useState(false);
  const done = !!set.logged_at;

  const save = (nextRpe: number | null = rpe) => {
    const repsN = parseNum(reps);
    onSave(set.id, {
      weight: parseNum(weight),
      reps: repsN === null ? null : Math.round(repsN),
      rpe: nextRpe,
    });
  };

  const onPickRpe = (v: number | null) => {
    setRpe(v);
    setRpeOpen(false);
    save(v);
    // выставление RPE = подход сделан (если ещё не отмечен)
    if (!done && v != null) onToggleDone(set);
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
      onEndEditing={() => save()}
      placeholder={placeholder}
      placeholderTextColor={PLACEHOLDER}
      keyboardType={keyboardType}
      className="flex-1 rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
    />
  );

  return (
    <View
      className="mt-2 rounded-xl p-2"
      style={{ backgroundColor: done ? 'rgba(31,184,154,0.08)' : 'rgba(12,14,18,0.4)' }}
    >
      <View className="mb-1 flex-row items-center justify-between px-1">
        <Text className="text-xs text-graphite-500" numberOfLines={1}>
          {headerLabel ?? `${t('workout.set')} ${index}`}
          {done && set.rest_sec != null ? `  ·  ${t('workout.rest')} ${fmt(set.rest_sec)}` : ''}
        </Text>
        <Pressable onPress={() => onDelete(set.id)} hitSlop={8}>
          <Text className="text-xs text-graphite-600">✕</Text>
        </Pressable>
      </View>
      <View className="flex-row items-center gap-2">
        {field(weight, setWeight, `${t('workout.weight')}, ${t(`common.${unit}`)}`)}
        {field(reps, setReps, t('workout.reps'), 'number-pad')}
        <Pressable
          onPress={() => setRpeOpen(true)}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-graphite-800 px-2 py-2 active:opacity-80"
        >
          {rpe != null && (
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: rpeColor(rpe) ?? '#848D9A' }}
            />
          )}
          <Text
            className="text-center text-sm"
            style={{ color: rpe != null ? '#E5E7EB' : PLACEHOLDER }}
          >
            {rpe != null ? `${t('workout.rpe')} ${rpe}` : t('workout.rpe')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleDone(set)}
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-80"
          style={{ backgroundColor: done ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
        >
          <Text style={{ color: done ? '#0B0F14' : '#848D9A', fontWeight: '900' }}>✓</Text>
        </Pressable>
      </View>
      <RpePicker visible={rpeOpen} value={rpe} onClose={() => setRpeOpen(false)} onSelect={onPickRpe} />
    </View>
  );
}

function ExercisePicker({
  visible,
  onClose,
  onSelect,
  onCreate,
  creating,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (exerciseId: string) => void;
  onCreate: (name: string) => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const lang = i18n.language;
  const [term, setTerm] = useState('');
  const searching = term.trim() !== '';
  const { data, isFetching } = useQuery({
    queryKey: ['exercises-all'],
    queryFn: listExercises,
    enabled: visible,
  });
  const { data: recent } = useQuery({
    queryKey: ['exercises-recent'],
    queryFn: () => getRecentExercises(8),
    enabled: visible,
  });

  // сбрасываем поиск при каждом открытии — заново то же упражнение почти не выбирают
  useEffect(() => {
    if (visible) setTerm('');
  }, [visible]);

  const groups = useMemo(() => {
    const filtered = (data ?? []).filter((ex) => matchExercise(ex, term));
    return groupByCluster(filtered);
  }, [data, term]);

  const row = (ex: (typeof groups)[number]['items'][number]) => (
    <Pressable
      key={ex.id}
      onPress={() => onSelect(ex.id)}
      className="flex-row items-center justify-between border-b border-graphite-800 py-3 active:opacity-70"
    >
      <Text className="flex-1 text-base text-graphite-100">{exerciseName(ex, lang)}</Text>
      <Text className="ml-3 text-xs text-graphite-500">
        {ex.is_global ? t(categoryKey(ex.category)) : t('workout.userAdded')}
      </Text>
    </Pressable>
  );

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
              value={term}
              onChangeText={setTerm}
              placeholder={t('workout.search')}
              placeholderTextColor={PLACEHOLDER}
              returnKeyType="search"
              className="flex-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-graphite-400">{t('common.cancel')}</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            className="mt-3"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {isFetching && <ActivityIndicator color="#848D9A" />}

            {searching && (
              <Pressable
                onPress={() => onCreate(term.trim())}
                disabled={creating}
                className="mb-2 flex-row items-center gap-2 rounded-xl bg-graphite-800 px-3 py-3 active:opacity-80"
              >
                {creating ? (
                  <ActivityIndicator color="#848D9A" />
                ) : (
                  <>
                    <Text className="text-base text-accent">＋</Text>
                    <Text className="flex-1 text-base text-graphite-100">
                      {t('workout.createCustom', { name: term.trim() })}
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {!isFetching && !searching && groups.length === 0 && (
              <Text className="text-base text-graphite-400">{t('workout.noResults')}</Text>
            )}

            {!searching && recent && recent.length > 0 && (
              <View className="mb-2">
                <Text className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {t('workout.frequent')}
                </Text>
                {recent.map((ex) => row(ex))}
              </View>
            )}

            {groups.map((g) => (
              <View key={g.cluster ?? 'other'} className="mb-2">
                <Text className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {t(clusterKey(g.cluster))}
                </Text>
                {g.items.map((ex) => row(ex))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

type WGroup = {
  key: string;
  label: string | null;
  rounds: number | null;
  type: string | null;
  intervalSec: number | null;
  items: WorkoutExercise[];
};

export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = String(id);
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const insets = useSafeAreaInsets();
  const lang = i18n.language;
  const { session, initializing } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  // локально развёрнутые завершённые упражнения (по тапу на свёрнутую карточку)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // свёрнутые кластеры (круги/EMOM/суперсеты)
  const [clusterCol, setClusterCol] = useState<Record<string, boolean>>({});

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
    enabled: !!session,
  });

  // якорь авто-отдыха = время последнего «сделанного» подхода
  const anchor = useMemo(() => {
    if (!workout) return null;
    let max = 0;
    for (const we of workout.workout_exercises)
      for (const s of we.sets)
        if (s.logged_at) {
          const ts = +new Date(s.logged_at);
          if (ts > max) max = ts;
        }
    return max || null;
  }, [workout]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workout', workoutId] });

  const addExerciseMut = useMutation({
    mutationFn: (exerciseId: string) =>
      addWorkoutExercise(workoutId, exerciseId, workout?.workout_exercises.length ?? 0),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['exercises-recent'] });
      setPickerOpen(false);
    },
  });

  const createExerciseMut = useMutation({
    mutationFn: (name: string) => createCustomExercise(session!.user.id, name),
    onSuccess: (ex) => {
      qc.invalidateQueries({ queryKey: ['exercises-all'] });
      addExerciseMut.mutate(ex.id);
    },
    onError: (e: Error) => {
      Alert.alert(
        '',
        e.message === 'exercise_daily_cap' ? t('workout.customCapped') : t('programs.errGeneric'),
      );
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

  const setLoggedMut = useMutation({
    mutationFn: (v: { id: string; logged: boolean; restSec: number | null }) =>
      setSetLogged(v.id, v.logged, v.restSec),
    onSuccess: invalidate,
  });

  const finishExerciseMut = useMutation({
    mutationFn: (v: { weId: string; done: boolean }) => setExerciseDone(v.weId, v.done),
    onSuccess: invalidate,
  });

  // отметить/снять «подход сделан»; при отметке отдых = разрыв с прошлым сделанным
  const onToggleDone = (set: SetRowType) => {
    const logged = !!set.logged_at;
    const rest = !logged && anchor ? Math.max(0, Math.round((Date.now() - anchor) / 1000)) : null;
    setLoggedMut.mutate({ id: set.id, logged: !logged, restSec: rest });
  };

  const finishMut = useMutation({
    mutationFn: () => finishWorkout(workoutId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workouts'] });
      router.replace({ pathname: '/summary/[id]', params: { id: workoutId } });
    },
  });

  // одно упражнение-карточка (свёрнутая/развёрнутая). nested — внутри кластера (другой фон).
  const renderExercise = (we: WorkoutExercise, nested = false) => {
    const name = we.exercise ? exerciseName(we.exercise, lang) : '—';
    const collapsed = !!we.done_at && !expanded[we.id];
    const doneSets = we.sets.filter((s) => s.logged_at);
    const best = doneSets.reduce<SetRowType | null>(
      (b, s) => ((s.weight ?? 0) > (b?.weight ?? -1) ? s : b),
      null,
    );
    const cardBg = nested ? 'bg-graphite-800' : 'bg-graphite-900';

    if (collapsed) {
      return (
        <Pressable
          key={we.id}
          onPress={() => setExpanded((e) => ({ ...e, [we.id]: true }))}
          className={`flex-row items-center justify-between rounded-2xl ${cardBg} p-4 active:opacity-80`}
        >
          <View className="flex-1">
            <Text className="text-base font-bold text-graphite-100">{name}</Text>
            <Text className="mt-0.5 text-xs text-graphite-500">
              {setsLabel(doneSets.length)}
              {best?.weight != null
                ? ` · ${best.weight} ${t(`common.${unit}`)}${best.reps != null ? ` × ${best.reps}` : ''}`
                : ''}
            </Text>
          </View>
          <Text className="ml-2 text-base text-accent">✓</Text>
        </Pressable>
      );
    }

    return (
      <View key={we.id} className={`rounded-2xl ${cardBg} p-4`}>
        {we.done_at ? (
          <Pressable
            onPress={() => setExpanded((e) => ({ ...e, [we.id]: false }))}
            className="flex-row items-center justify-between active:opacity-80"
          >
            <Text className="flex-1 text-base font-bold text-graphite-50">{name}</Text>
            <Text className="ml-2 text-graphite-500">▲</Text>
          </Pressable>
        ) : (
          <Text className="text-base font-bold text-graphite-50">{name}</Text>
        )}
        {we.sets.map((s, i) => (
          <SetRow
            key={s.id}
            index={i + 1}
            set={s}
            unit={unit}
            onSave={(setId, input) => updateSetMut.mutate({ id: setId, input })}
            onToggleDone={onToggleDone}
            onDelete={(setId) => deleteSetMut.mutate(setId)}
          />
        ))}
        <View className="mt-3 flex-row gap-2">
          <Pressable
            disabled={addSetMut.isPending}
            onPress={() => addSetMut.mutate({ weId: we.id, input: {} })}
            className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-graphite-200">{t('workout.addSet')}</Text>
          </Pressable>
          {we.done_at ? (
            <Pressable
              onPress={() => finishExerciseMut.mutate({ weId: we.id, done: false })}
              className="flex-1 items-center rounded-xl bg-graphite-800 py-3 active:opacity-80"
            >
              <Text className="text-sm font-bold text-graphite-100">{t('workout.reopenExercise')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                finishExerciseMut.mutate({ weId: we.id, done: true });
                setExpanded((e) => ({ ...e, [we.id]: false }));
              }}
              className="flex-1 items-center rounded-xl bg-graphite-800 py-3 active:opacity-80"
            >
              <Text className="text-sm font-bold text-graphite-100">{t('workout.finishExercise')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  // кластер (круг/EMOM/суперсет): рендерим раунд-за-раундом — все упражнения одного раунда подряд
  const renderCluster = (g: WGroup) => {
    const collapsed = clusterCol[g.key];
    const totalSets = g.items.reduce((n, it) => n + it.sets.length, 0);
    const doneSets = g.items.reduce((n, it) => n + it.sets.filter((s) => s.logged_at).length, 0);
    const maxRounds = g.items.reduce((m, it) => Math.max(m, it.sets.length), 0);
    const allDone = g.items.length > 0 && g.items.every((it) => it.done_at);
    const isEmom = (g.type === 'emom' || g.type === 'e2mom') && !!g.intervalSec;

    return (
      <View key={g.key} className="rounded-2xl bg-graphite-900 p-3">
        <Pressable
          onPress={() => setClusterCol((c) => ({ ...c, [g.key]: !c[g.key] }))}
          className="flex-row items-center justify-between border-l-2 border-accent px-3 py-1 active:opacity-80"
        >
          <View className="flex-1">
            <Text className="text-sm font-extrabold uppercase tracking-wide text-accent">
              {g.label || t('blockTypes.rounds')}
            </Text>
            {g.rounds ? <Text className="mt-0.5 text-xs text-graphite-400">{g.rounds}×</Text> : null}
          </View>
          <Text className="ml-2 text-graphite-500">{collapsed ? '▼' : '▲'}</Text>
        </Pressable>

        {collapsed ? (
          <Text className="px-3 pt-2 text-xs text-graphite-500">
            {doneSets}/{totalSets} ✓
          </Text>
        ) : (
          <View className="mt-2">
            {isEmom && <EmomTimer intervalSec={g.intervalSec!} />}
            {Array.from({ length: maxRounds }).map((_, r) => (
              <View key={r} className="mb-3">
                <Text className="mb-1 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {t('workout.round', { n: r + 1 })}
                </Text>
                <View className="gap-2">
                  {g.items.map((it) => {
                    const s = it.sets[r];
                    if (!s) return null;
                    return (
                      <SetRow
                        key={s.id}
                        index={r + 1}
                        set={s}
                        unit={unit}
                        headerLabel={it.exercise ? exerciseName(it.exercise, lang) : '—'}
                        onSave={(setId, input) => updateSetMut.mutate({ id: setId, input })}
                        onToggleDone={onToggleDone}
                        onDelete={(setId) => deleteSetMut.mutate(setId)}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
            <View className="mt-1 flex-row gap-2">
              <Pressable
                disabled={addSetMut.isPending}
                onPress={() => g.items.forEach((it) => addSetMut.mutate({ weId: it.id, input: {} }))}
                className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                <Text className="text-sm font-semibold text-graphite-200">{t('workout.addRound')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const done = !allDone;
                  g.items.forEach((it) => finishExerciseMut.mutate({ weId: it.id, done }));
                  if (done) setClusterCol((c) => ({ ...c, [g.key]: true }));
                }}
                className="flex-1 items-center rounded-xl bg-graphite-800 py-3 active:opacity-80"
              >
                <Text className="text-sm font-bold text-graphite-100">
                  {allDone ? t('workout.reopenBlock') : t('workout.finishBlock')}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  // группируем подряд идущие упражнения одного кластера (block_key)
  const wgroups: WGroup[] = [];
  for (const we of workout?.workout_exercises ?? []) {
    const last = wgroups[wgroups.length - 1];
    if (we.block_key && last && last.key === we.block_key) last.items.push(we);
    else if (we.block_key)
      wgroups.push({
        key: we.block_key,
        label: we.block_label,
        rounds: we.block_rounds,
        type: we.block_type,
        intervalSec: we.block_interval_sec,
        items: [we],
      });
    else
      wgroups.push({ key: we.id, label: null, rounds: null, type: null, intervalSec: null, items: [we] });
  }

  if (!initializing && !session) return <Redirect href="/auth" />;

  if (isLoading || !workout) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
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
          {wgroups.map((g) => {
            const isCluster = g.label != null || g.items.length > 1;
            return isCluster ? renderCluster(g) : renderExercise(g.items[0]);
          })}
        </ScrollView>

        <Pressable
          onPress={() => setPickerOpen(true)}
          style={{ marginBottom: insets.bottom + 8 }}
          className="rounded-2xl border border-graphite-700 py-4 active:opacity-70"
        >
          <Text
            numberOfLines={1}
            style={{ width: '100%', textAlign: 'center' }}
            className="text-base font-semibold text-graphite-100"
          >
            {t('workout.addExercise')}
          </Text>
        </Pressable>
      </View>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(exerciseId) => addExerciseMut.mutate(exerciseId)}
        onCreate={(name) => createExerciseMut.mutate(name)}
        creating={createExerciseMut.isPending}
      />
    </SafeAreaView>
  );
}
