import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ExercisePicker } from '@/components/exercise-picker';
import { useAuth } from '@/lib/auth/auth-context';
import {
  createCustomExercise,
  disciplineToEnable,
  enableDiscipline,
  type Exercise,
  exerciseName,
  exerciseSided,
  getDisciplines,
  listExercises,
  type Metric,
  type SetSide,
  SET_SIDES,
} from '@/lib/db/exercises';
import { newId } from '@/lib/db/ids';
import i18n from '@/lib/i18n';
import {
  addProgramExercise,
  addProgramSet,
  buildWorkoutFromProgram,
  createProgramBlock,
  deleteProgram,
  deleteProgramBlock,
  deleteProgramExercise,
  deleteProgramSet,
  getProgramDetail,
  groupProgram,
  isClusterBlock,
  type ProgramBlock,
  type ProgramDetail,
  type ProgramSet,
  reorderProgramExercises,
  updateProgram,
  updateProgramExercise,
  updateProgramSet,
} from '@/lib/db/programs';
import { WORKOUT_START } from '@/lib/db/workout-mutations';
import { summarizeWorkout, type WorkoutDetail, type WorkoutSummary } from '@/lib/db/workouts';
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
  meta?: Record<string, unknown> | null;
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
  metric,
  sided,
  onSave,
  onDelete,
}: {
  index: number;
  set: ProgramSet;
  unit: WeightUnit;
  metric?: Metric;
  sided?: boolean;
  onSave: (id: string, patch: SetPatch) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  // метрика упражнения — источник истины (свежий подход ещё без данных): time → вага/секунди,
  // reps → вага/повтори. Для несматченных упражнений (metric неизвестна) — по данным подхода.
  const isTime = metric != null ? metric === 'time' : set.target_duration_sec != null;
  // сторона плана: локальный стейт для мгновенного отклика (как вес/повторы), персист по тапу.
  // Циклится нет → ліва → права → обидві → нет; «обидві» = объём ×2 при подсчёте (как в логе).
  const [side, setSide] = useState<SetSide | undefined>(
    (set.meta as { side?: SetSide } | null)?.side,
  );
  const cycleSide = () => {
    const order: (SetSide | undefined)[] = [undefined, ...SET_SIDES];
    const next = order[(order.indexOf(side) + 1) % order.length];
    setSide(next);
    const meta = { ...(set.meta as Record<string, unknown> | null) };
    if (next) meta.side = next;
    else delete meta.side;
    onSave(set.id, { meta: Object.keys(meta).length ? meta : null });
  };
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
  // коммитим «на лету» при каждом изменении значения — не зависим от blur/фокуса, поэтому
  // «зберегти»/«завершити» никогда не теряют последнее введённое (первый рендер пропускаем)
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, reps, secs]);

  return (
    <View className="flex-row items-start gap-2">
      <Text className="w-5 pt-2 text-sm text-graphite-600">{index}</Text>
      <View className="flex-1">
        <TextInput
          value={weight}
          onChangeText={setWeight}
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
          placeholder={isTime ? t('workout.secShort') : t('workout.reps')}
          placeholderTextColor="#848D9A"
          keyboardType="number-pad"
          className="rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
        />
        <Text className="mt-0.5 text-center text-[10px] text-graphite-600">
          {isTime ? t('workout.secShort') : t('workout.repsShort')}
        </Text>
      </View>
      {sided && (
        <Pressable
          onPress={cycleSide}
          hitSlop={6}
          className="justify-center rounded-lg border border-graphite-700 px-2 py-2"
        >
          <Text className={side ? 'text-[11px] text-graphite-200' : 'text-[11px] text-graphite-500'}>
            {side ? t(`workout.side_${side}`) : t('workout.side')}
          </Text>
        </Pressable>
      )}
      <Pressable onPress={() => onDelete(set.id)} hitSlop={8} className="pt-2">
        <Text className="text-base text-red-400">✕</Text>
      </Pressable>
    </View>
  );
}

type BlockPatch = {
  type: string;
  label?: string | null;
  rounds?: number | null;
  interval_sec?: number | null;
  duration_sec?: number | null;
};

const BLOCK_TYPES = ['superset', 'emom', 'e2mom', 'amrap'] as const;
const AMRAP_QUICK = [1, 5, 20];

// Конфигуратор кластер-блока: тип + параметры (суперсет→раунди; EMOM/E2MOM/AMRAP→хвилини).
function BlockConfigModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (patch: BlockPatch) => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<string>('superset');
  const [label, setLabel] = useState('');
  const [rounds, setRounds] = useState('3');
  const [minutes, setMinutes] = useState('16');

  useEffect(() => {
    if (visible) {
      setType('superset');
      setLabel('');
      setRounds('3');
      setMinutes('16');
    }
  }, [visible]);

  const isRounds = type === 'superset';
  const submit = () => {
    const patch: BlockPatch = { type, label: label.trim() || null };
    if (type === 'superset') {
      patch.rounds = Math.max(1, parseInt(rounds || '1', 10) || 1);
    } else if (type === 'amrap') {
      patch.duration_sec = Math.max(1, parseInt(minutes || '1', 10) || 1) * 60;
    } else {
      // emom / e2mom: интервал фиксирован типом, круги считаются из длительности при старте
      patch.interval_sec = type === 'e2mom' ? 120 : 60;
      patch.duration_sec = Math.max(1, parseInt(minutes || '1', 10) || 1) * 60;
    }
    onCreate(patch);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <SafeAreaView edges={['bottom']} className="rounded-t-3xl bg-graphite-900 px-5 pt-5">
          <Text className="text-lg font-extrabold text-graphite-50">{t('programs.blockNew')}</Text>

          <View className="mt-4 flex-row flex-wrap gap-2">
            {BLOCK_TYPES.map((bt) => (
              <Pressable
                key={bt}
                onPress={() => setType(bt)}
                className={`rounded-xl border px-3 py-2 ${
                  type === bt ? 'border-accent bg-accent/10' : 'border-graphite-700'
                }`}
              >
                <Text className={type === bt ? 'text-sm font-bold text-accent' : 'text-sm text-graphite-300'}>
                  {t(`blockTypes.${bt}`)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-4">
            <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {isRounds ? t('programs.blockRounds') : t('programs.blockMinutes')}
            </Text>
            <TextInput
              value={isRounds ? rounds : minutes}
              onChangeText={isRounds ? setRounds : setMinutes}
              keyboardType="number-pad"
              className="rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            {type === 'amrap' && (
              <View className="mt-2 flex-row gap-2">
                {AMRAP_QUICK.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMinutes(String(m))}
                    className="rounded-lg border border-graphite-700 px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-xs text-graphite-300">{m} {t('summary.min')}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View className="mt-4">
            <Text className="mb-1 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {t('programs.blockLabelOpt')}
            </Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder={t(`blockTypes.${type}`)}
              placeholderTextColor="#848D9A"
              className="rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
          </View>

          <View className="mt-5 flex-row gap-3 pb-2">
            <Pressable
              onPress={onClose}
              className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
            >
              <Text className="text-sm font-semibold text-graphite-200">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              className="flex-1 items-center rounded-xl bg-accent py-3 active:opacity-80"
            >
              <Text className="text-sm font-bold text-graphite-950">{t('programs.blockCreate')}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function ProgramDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useWeightUnit();
  const insets = useSafeAreaInsets();
  const { session, initializing } = useAuth();
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  // свежесозданная вручную программа приходит с ?edit=1 → сразу открываем на добавление упражнений
  const [editMode, setEditMode] = useState(edit === '1');
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // в какой блок добавляем из пикера (null = standalone-упражнение); конфигуратор блока
  const [pickerBlockId, setPickerBlockId] = useState<string | null>(null);
  const [blockCfgOpen, setBlockCfgOpen] = useState(false);

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => getProgramDetail(id),
    enabled: !!id && !!session,
  });

  // каталог упражнений (кэш ['exercises-all']) — для верной метрики/имени в оптимистичном дереве
  const { data: catalog } = useQuery({
    queryKey: ['exercises-all'],
    queryFn: listExercises,
    enabled: !!session,
  });
  const catalogById = useMemo(() => new Map((catalog ?? []).map((e) => [e.id, e])), [catalog]);

  // включённые дисциплины — фильтр видимости в пикере (как в логировании тренировки)
  const { data: disciplines } = useQuery({
    queryKey: ['disciplines', session?.user.id],
    queryFn: () => getDisciplines(session!.user.id),
    enabled: !!session,
  });

  // ручной конструктор: добавить упражнение из каталога в конец программы. Online-only —
  // как остальные правки программы (конструктор осознанно не offline-durable, см. день-37).
  const addExMut = useMutation({
    mutationFn: (v: { ex: Exercise; blockId: string | null; order: number; seedSets: number }) =>
      addProgramExercise(id, v.ex.id, exerciseName(v.ex, i18n.language), v.order, v.blockId),
    onSuccess: async (peId, v) => {
      // предсоздаём плановые подходы: суперсет → N (по кругам, заполняешь явно 12/10/8), иначе 1
      for (let i = 0; i < Math.max(1, v.seedSets); i++) await addProgramSet(peId, i);
      qc.invalidateQueries({ queryKey: ['program', id] });
      qc.invalidateQueries({ queryKey: ['exercises-recent'] });
    },
  });
  // добавить упражнение в текущую цель (pickerBlockId): порядок = число упр. в той же группе.
  // Суперсет → предсоздаём N подходов (по числу кругов блока), иначе 1.
  const addExerciseToProgram = (ex: Exercise) => {
    const blockId = pickerBlockId;
    const block = blockId ? program?.program_blocks.find((b) => b.id === blockId) : null;
    const seedSets = block?.type === 'superset' ? (block.rounds ?? 1) : 1;
    const order = program?.program_exercises.filter((pe) => pe.block_id === blockId).length ?? 0;
    addExMut.mutate({ ex, blockId, order, seedSets });
    setPickerOpen(false);
    setPickerBlockId(null);
  };
  const enableDisciplineMut = useMutation({
    mutationFn: (d: Parameters<typeof enableDiscipline>[1]) => enableDiscipline(session!.user.id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['disciplines', session?.user.id] }),
  });
  // упражнение из ещё не включённой дисциплины — тихо включаем её словник, затем добавляем
  const onPickExercise = (ex: Exercise) => {
    const d = disciplineToEnable(ex, disciplines ?? []);
    if (d) enableDisciplineMut.mutate(d);
    addExerciseToProgram(ex);
  };
  // «+ своё» в пикере — создаём кастомное упражнение (серверный каталог), затем добавляем в прогу
  const createExMut = useMutation({
    mutationFn: (name: string) => createCustomExercise(session!.user.id, name),
    onSuccess: (ex) => {
      qc.invalidateQueries({ queryKey: ['exercises-all'] });
      addExerciseToProgram(ex);
    },
    onError: (e: Error) =>
      Alert.alert(
        '',
        e.message === 'exercise_daily_cap' ? t('workout.customCapped') : t('programs.errGeneric'),
      ),
  });
  // создать блок → сразу открыть пикер на добавление первого упражнения в него
  const createBlockMut = useMutation({
    mutationFn: (patch: BlockPatch) =>
      createProgramBlock(id, patch, program?.program_blocks.length ?? 0),
    onSuccess: (blockId) => {
      qc.invalidateQueries({ queryKey: ['program', id] });
      setBlockCfgOpen(false);
      setPickerBlockId(blockId);
      setPickerOpen(true);
    },
  });
  const delBlockMut = useMutation({
    mutationFn: (blockId: string) => deleteProgramBlock(blockId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['program', id] }),
  });

  // старт регистрируется через mutationKey → переживает перезапуск (доживёт в оффлайн-очереди)
  // дженерики явно: при mutationKey без mutationFn TS иначе выводит variables как void
  const startMut = useMutation<void, Error, WorkoutDetail>({ mutationKey: WORKOUT_START });

  const onStart = () => {
    if (!program || !session) return;
    const workout = buildWorkoutFromProgram(session.user.id, program, unit, catalogById);
    // посев СИНХРОННО до навигации: дерево тренировки + список недавних → экран тренировки
    // открывается мгновенно и работает оффлайн; серверная запись уходит фоном (см. ниже)
    qc.setQueryData(['workout', workout.id], workout);
    qc.setQueryData<WorkoutSummary[]>(['workouts', session.user.id], (old) =>
      old ? [summarizeWorkout(workout), ...old] : [summarizeWorkout(workout)],
    );
    startMut.mutate(workout); // оффлайн — встанет в очередь и доиграется на реконнекте
    router.replace({ pathname: '/workout/[id]', params: { id: workout.id } });
  };

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
  // оптимистичное добавление подхода: вставляем строку в кэш сразу (мгновенный отклик — иначе
  // подход появляется только после round-trip и юзер тапает повторно, плодя лишние подходы),
  // откат при ошибке, финальная сверка через invalidate
  const addSetMut = useMutation({
    mutationFn: (v: { peId: string; order: number; sid: string }) =>
      addProgramSet(v.peId, v.order, v.sid),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['program', id] });
      const prev = qc.getQueryData<ProgramDetail>(['program', id]);
      qc.setQueryData<ProgramDetail>(['program', id], (old) =>
        old
          ? {
              ...old,
              program_exercises: old.program_exercises.map((pe) =>
                pe.id === v.peId
                  ? {
                      ...pe,
                      program_sets: [
                        ...pe.program_sets,
                        {
                          id: v.sid,
                          program_exercise_id: v.peId,
                          order_index: v.order,
                          target_reps: null,
                          target_duration_sec: null,
                          target_weight: null,
                          target_rpe: null,
                          rest_sec: null,
                          notes: null,
                          meta: null,
                        },
                      ],
                    }
                  : pe,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['program', id], ctx.prev);
    },
    onSettled: invalidate,
  });
  // оптимистично: коммит-на-лету пишет по каждому изменению → без рефетча (иначе лаг при печати).
  // patch = серверная истина (вес/повторы/сек/сторона), поэтому invalidate не нужен, только откат.
  const updateSetMut = useMutation({
    mutationFn: (v: { id: string; patch: SetPatch }) => updateProgramSet(v.id, v.patch),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['program', id] });
      const prev = qc.getQueryData<ProgramDetail>(['program', id]);
      qc.setQueryData<ProgramDetail>(['program', id], (old) =>
        old
          ? {
              ...old,
              program_exercises: old.program_exercises.map((pe) => ({
                ...pe,
                program_sets: pe.program_sets.map((s) => (s.id === v.id ? { ...s, ...v.patch } : s)),
              })),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['program', id], ctx.prev);
    },
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
              Keyboard.dismiss(); // коммит сфокусированного инпута (назва/ім'я) перед выходом из edit
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
                    <View className="mb-3 flex-row items-start justify-between">
                      <View className="flex-1 border-l-2 border-accent pl-3">
                        <Text className="text-base font-extrabold uppercase tracking-wide text-accent">
                          {g.block?.label || t(`blockTypes.${g.block?.type ?? 'single'}`)}
                        </Text>
                        {meta ? <Text className="mt-0.5 text-xs text-graphite-400">{meta}</Text> : null}
                      </View>
                      {editMode && g.block && (
                        <Pressable
                          onPress={() => delBlockMut.mutate(g.block!.id)}
                          hitSlop={8}
                          className="ml-2 pt-0.5"
                        >
                          <Text className="text-base text-red-400">✕</Text>
                        </Pressable>
                      )}
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
                              metric={pe.exercise_id ? catalogById.get(pe.exercise_id)?.metric : undefined}
                              sided={exerciseSided(
                                pe.exercise_id ? catalogById.get(pe.exercise_id) : undefined,
                                pe.name,
                              )}
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
                            onPress={() =>
                              addSetMut.mutate({ peId: pe.id, order: pe.program_sets.length, sid: newId() })
                            }
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

                  {editMode && isCluster && g.block && (
                    <Pressable
                      onPress={() => {
                        setPickerBlockId(g.block!.id);
                        setPickerOpen(true);
                      }}
                      className="mt-3 items-center rounded-xl border border-dashed border-graphite-700 py-3 active:opacity-70"
                    >
                      <Text className="text-xs font-bold text-accent">＋ {t('programs.addToBlock')}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}

          {editMode && (
            <View className="mb-3 flex-row gap-3">
              <Pressable
                onPress={() => {
                  setPickerBlockId(null);
                  setPickerOpen(true);
                }}
                className="flex-1 items-center rounded-2xl border border-dashed border-graphite-700 py-4 active:opacity-70"
              >
                <Text className="text-sm font-bold text-accent">＋ {t('programs.addExercise')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setBlockCfgOpen(true)}
                className="flex-1 items-center rounded-2xl border border-dashed border-graphite-700 py-4 active:opacity-70"
              >
                <Text className="text-sm font-bold text-accent">＋ {t('programs.addBlock')}</Text>
              </Pressable>
            </View>
          )}
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
                onPress={onStart}
                className="items-center rounded-2xl bg-accent py-4 active:opacity-80"
              >
                <Text className="text-base font-bold text-graphite-950">{t('home.start')}</Text>
              </Pressable>
            )
          )}
        </View>
      )}


      <ExercisePicker
        visible={pickerOpen}
        disciplines={disciplines ?? []}
        onClose={() => {
          setPickerOpen(false);
          setPickerBlockId(null);
        }}
        onSelect={onPickExercise}
        onCreate={(name) => createExMut.mutate(name)}
        creating={createExMut.isPending}
      />

      <BlockConfigModal
        visible={blockCfgOpen}
        onClose={() => setBlockCfgOpen(false)}
        onCreate={(patch) => createBlockMut.mutate(patch)}
      />

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
