import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  type KeyboardTypeOptions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SyncStatus } from '@/components/sync-status';

import {
  createCustomExercise,
  disciplineToEnable,
  enableDiscipline,
  type Exercise,
  exerciseName,
  exerciseSided,
  getDisciplines,
  GRIP_SET_TYPES,
  type GripMeta,
  type Metric,
  type SetSide,
} from '@/lib/db/exercises';
import { type Gripper, gripperName, listGripperCatalog, rgcInKg } from '@/lib/db/grippers';
import {
  getWorkoutDetail,
  isClusteredWorkoutExercise,
  type SetInput,
  type SetRow as SetRowType,
  type WorkoutExercise,
} from '@/lib/db/workouts';
import { ExercisePicker } from '@/components/exercise-picker';
import { useAuth } from '@/lib/auth/auth-context';
import { newId } from '@/lib/db/ids';
import {
  type AddSetVars,
  type AddWeVars,
  type DeleteSetVars,
  type DoneWeVars,
  type FinishVars,
  type LogSetVars,
  type RemoveWeVars,
  type ReorderWeVars,
  SET_ADD,
  SET_DELETE,
  SET_LOG,
  SET_UPDATE,
  type UpdateSetVars,
  WE_ADD,
  WE_DONE,
  WE_REMOVE,
  WE_REORDER,
  WORKOUT_FINISH,
} from '@/lib/db/workout-mutations';
import i18n from '@/lib/i18n';
import { setsLabel } from '@/lib/i18n/plural';
import { formatWeight, fromKg, toKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';

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

// Выбор эспандера (каталог брендов + свои сверху) + вида установки. Пишем в sets.meta.
function GripPicker({
  visible,
  value,
  grippers,
  onClose,
  onChange,
}: {
  visible: boolean;
  value: GripMeta;
  grippers: Gripper[];
  onClose: () => void;
  onChange: (meta: GripMeta) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [term, setTerm] = useState('');
  useEffect(() => {
    if (visible) setTerm('');
  }, [visible]);

  // секции: личные (приоритет, сверху) + глобальные по бренду
  const sections = useMemo(() => {
    const q = term.trim().toLowerCase();
    const match = (g: Gripper) => !q || gripperName(g).toLowerCase().includes(q);
    const personal = grippers.filter((g) => !g.is_global && match(g));
    const byBrand = new Map<string, Gripper[]>();
    for (const g of grippers) {
      if (!g.is_global || !match(g)) continue;
      const b = g.brand ?? '—';
      const arr = byBrand.get(b) ?? [];
      arr.push(g);
      byBrand.set(b, arr);
    }
    const out: { title: string; items: Gripper[] }[] = [];
    if (personal.length) out.push({ title: t('account.myGrippers'), items: personal });
    for (const [b, items] of byBrand) out.push({ title: b, items });
    return out;
  }, [grippers, term, t]);

  const line = (g: Gripper) => {
    const active = value.gripper_id === g.id;
    const kg = rgcInKg(g);
    return (
      <Pressable
        key={g.id}
        onPress={() => onChange({ ...value, gripper_id: g.id })}
        className="flex-row items-center justify-between rounded-xl px-3 py-2.5 active:opacity-80"
        style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
      >
        <Text className="text-base font-semibold" style={{ color: active ? '#0B0F14' : '#E5E7EB' }}>
          {gripperName(g)}
        </Text>
        {g.rgc != null && (
          <Text className="text-xs" style={{ color: active ? '#0B0F14' : '#848D9A' }}>
            {g.rgc} {g.rgc_unit}
            {kg != null && g.rgc_unit === 'lb' ? ` · ${Math.round(kg)} kg` : ''}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          className="rounded-t-3xl bg-graphite-900 px-5 pt-4"
          style={{ maxHeight: '85%', paddingBottom: insets.bottom + 24 }}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-base font-bold text-graphite-50">{t('workout.gripper')}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-graphite-400">{t('common.cancel')}</Text>
            </Pressable>
          </View>
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('workout.searchGripper')}
            placeholderTextColor={PLACEHOLDER}
            className="rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            className="mt-3"
            style={{ maxHeight: 300 }}
          >
            {grippers.length === 0 && (
              <Text className="text-sm text-graphite-500">{t('workout.noGrippers')}</Text>
            )}
            {sections.map((s) => (
              <View key={s.title} className="mb-2">
                <Text className="mb-1 mt-1 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {s.title}
                </Text>
                <View className="gap-1">{s.items.map(line)}</View>
              </View>
            ))}
          </ScrollView>
          <Text className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('workout.setType')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {GRIP_SET_TYPES.map((st) => {
              const active = value.set_type === st;
              return (
                <Pressable
                  key={st}
                  onPress={() => onChange({ ...value, set_type: st })}
                  className="rounded-full px-3 py-1.5 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                    {t(`setTypes.${st}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={onClose} className="mt-5 items-center rounded-xl bg-graphite-50 py-3 active:opacity-80">
            <Text className="text-sm font-bold text-graphite-950">{t('summary.done')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ElapsedTimer({ startedAt, endedAt }: { startedAt: string; endedAt?: string | null }) {
  const { t } = useTranslation();
  const calc = () =>
    Math.max(0, Math.floor(((endedAt ? +new Date(endedAt) : Date.now()) - +new Date(startedAt)) / 1000));
  const [sec, setSec] = useState(calc);
  useEffect(() => {
    // завершённая тренировка (редактирование) — время заморожено на реальной длительности, без тикания
    if (endedAt) {
      setSec(calc());
      return;
    }
    const id = setInterval(() => setSec(calc()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, endedAt]);
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
  metric,
  logKind,
  grippers,
  onSave,
  onToggleDone,
  onAutoLog,
  onDelete,
  headerLabel,
  sided = false,
  locked = false,
}: {
  index: number;
  set: SetRowType;
  unit: WeightUnit;
  metric: Metric;
  logKind: string | null;
  grippers: Gripper[];
  onSave: (id: string, input: SetInput) => void;
  onToggleDone: (set: SetRowType) => void;
  onAutoLog: (set: SetRowType) => void;
  onDelete: (id: string) => void;
  headerLabel?: string;
  sided?: boolean; // показывать выбор стороны (односторонние / хват), для двусторонних — нет
  locked?: boolean; // блок/упражнение завершён → только чтение (правка после «Відновити»)
}) {
  const { t } = useTranslation();
  // временной подход: дефолт упражнения = 'time' ИЛИ у подхода уже есть длительность.
  // per-set: режим переопределяется тумблером (натяжку можно держать статикой на сек,
  // а следующий подход делать на повторы — в одном упражнении).
  const [isTime, setIsTime] = useState(metric === 'time' || set.duration_sec != null);
  const isGripper = logKind === 'gripper';
  // вес храним канонически в кг; поле редактируем в выбранной единице (кг↔lb)
  const [weight, setWeight] = useState(set.weight != null ? formatWeight(set.weight, unit) : '');
  const [amount, setAmount] = useState(
    (isTime ? set.duration_sec : set.reps)?.toString() ?? '',
  );
  const [rpe, setRpe] = useState<number | null>(set.rpe ?? null);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [meta, setMeta] = useState<GripMeta>((set.meta as GripMeta) ?? {});
  const [gripOpen, setGripOpen] = useState(false);
  const done = !!set.logged_at;

  const save = (
    nextRpe: number | null = rpe,
    nextMeta: GripMeta = meta,
    timeMode: boolean = isTime,
  ) => {
    const n = parseNum(amount);
    const rounded = n === null ? null : Math.round(n);
    onSave(set.id, {
      weight: isGripper ? null : toKg(parseNum(weight), unit),
      reps: timeMode ? null : rounded,
      duration_sec: timeMode ? rounded : null,
      rpe: nextRpe,
      // meta теперь общий: эспандер + читинг/сторона. Сохраняем, когда есть что сохранять.
      meta: Object.keys(nextMeta).length > 0 ? nextMeta : undefined,
    });
  };
  // коммитим вес/повторы «на лету» при каждом изменении — НЕ зависим от blur/onEndEditing
  // (Keyboard.dismiss их не триггерит надёжно). Поэтому «завершити» никогда не теряет
  // введённое: к моменту тапа значение уже записано. Первый рендер пропускаем.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    save();
    // ввёл повторы/сек → подход автоматически «зроблений» (иначе без тапа ✓ он не в зачёте
    // тоннажа/счётчиков → «завершив, а всё 0»). Явный ✓ по-прежнему считает отдых.
    if (!done && parseNum(amount) != null) onAutoLog(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weight, amount]);

  // переключить режим этого подхода reps⟷сек: введённое число переезжает в нужную колонку,
  // вторая обнуляется (save с явным timeMode, т.к. setState асинхронен).
  const toggleMetric = () => {
    const next = !isTime;
    setIsTime(next);
    save(rpe, meta, next);
  };

  const onChangeMeta = (next: GripMeta) => {
    setMeta(next);
    save(rpe, next);
  };

  // сторона циклится тапом: нет → ліва → права → обидві → нет (без лишних окон).
  // «Обидві» = сделано на обе стороны на ОДНОМ весе → объём (повт/тоннаж) считается ×2.
  const cycleSide = () => {
    const order: (SetSide | undefined)[] = [undefined, 'left', 'right', 'both'];
    const i = order.indexOf(meta.side);
    const nextSide = order[(i + 1) % order.length];
    const next = { ...meta };
    if (nextSide) next.side = nextSide;
    else delete next.side;
    onChangeMeta(next);
  };
  const toggleCheat = () => onChangeMeta({ ...meta, cheat: !meta.cheat });

  const selectedGripper = grippers.find((g) => g.id === meta.gripper_id);
  const selectedGripperLabel = selectedGripper ? gripperName(selectedGripper) : undefined;

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
    caption: string,
    keyboardType: KeyboardTypeOptions = 'decimal-pad',
  ) => (
    <View className="flex-1">
      <TextInput
        value={value}
        onChangeText={onChange}
        onEndEditing={() => save()}
        editable={!locked}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER}
        keyboardType={keyboardType}
        className="rounded-lg bg-graphite-800 px-2 py-2 text-center text-sm text-graphite-50"
        style={{ opacity: locked ? 0.6 : 1 }}
      />
      <Text className="mt-0.5 text-center text-[10px] text-graphite-600">{caption}</Text>
    </View>
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
        {!locked && (
          <Pressable onPress={() => onDelete(set.id)} hitSlop={8}>
            <Text className="text-xs text-graphite-600">✕</Text>
          </Pressable>
        )}
      </View>
      {isGripper && (
        <View className="mb-2 flex-row gap-2">
          <Pressable
            disabled={locked}
            onPress={() => setGripOpen(true)}
            className="flex-1 rounded-lg bg-graphite-800 px-2 py-2 active:opacity-80"
          >
            <Text
              numberOfLines={1}
              className="text-center text-sm"
              style={{ color: selectedGripperLabel ? '#E5E7EB' : PLACEHOLDER }}
            >
              {selectedGripperLabel ?? t('workout.pickGripper')}
            </Text>
            <Text className="mt-0.5 text-center text-[10px] text-graphite-600">{t('workout.gripper')}</Text>
          </Pressable>
          <Pressable
            disabled={locked}
            onPress={() => setGripOpen(true)}
            className="flex-1 rounded-lg bg-graphite-800 px-2 py-2 active:opacity-80"
          >
            <Text
              numberOfLines={1}
              className="text-center text-sm"
              style={{ color: meta.set_type ? '#E5E7EB' : PLACEHOLDER }}
            >
              {meta.set_type ? t(`setTypes.${meta.set_type}`) : t('workout.setType')}
            </Text>
            <Text className="mt-0.5 text-center text-[10px] text-graphite-600">{t('workout.setType')}</Text>
          </Pressable>
        </View>
      )}
      <View className="flex-row items-start gap-2">
        {!isGripper && field(weight, setWeight, t('workout.weight'), t(`common.${unit}`))}
        {isTime
          ? field(amount, setAmount, t('workout.duration'), t('workout.secShort'), 'number-pad')
          : field(amount, setAmount, t('workout.reps'), t('workout.repsShort'), 'number-pad')}
        <Pressable
          disabled={locked}
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
          disabled={locked}
          onPress={() => {
            // фиксируем набранные вес/повторы перед отметкой «зроблено» — иначе значение,
            // введённое без потери фокуса (onEndEditing не сработал), потеряется
            if (!done) save();
            onToggleDone(set);
          }}
          className="h-9 w-9 items-center justify-center rounded-lg active:opacity-80"
          style={{ backgroundColor: done ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
        >
          <Text style={{ color: done ? '#0B0F14' : '#848D9A', fontWeight: '900' }}>✓</Text>
        </Pressable>
      </View>
      <View className="mt-2 flex-row items-center gap-2 px-1">
        {!isGripper && (
          <Pressable
            disabled={locked}
            onPress={toggleMetric}
            className="rounded-md bg-graphite-800 px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-[11px] text-graphite-300">
              {isTime ? t('workout.modeTime') : t('workout.modeReps')}
            </Text>
          </Pressable>
        )}
        {sided && (
          <Pressable
            disabled={locked}
            onPress={cycleSide}
            className="rounded-md bg-graphite-800 px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-[11px]" style={{ color: meta.side ? '#E5E7EB' : PLACEHOLDER }}>
              {meta.side ? t(`workout.side_${meta.side}`) : t('workout.side')}
            </Text>
          </Pressable>
        )}
        <Pressable
          disabled={locked}
          onPress={toggleCheat}
          className="flex-row items-center gap-1 rounded-md px-2.5 py-1 active:opacity-70"
          style={{ backgroundColor: meta.cheat ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.04)' }}
        >
          <Text className="text-[11px]" style={{ color: meta.cheat ? '#F59E0B' : PLACEHOLDER }}>
            {meta.cheat ? '☑' : '☐'} {t('workout.cheat')}
          </Text>
        </Pressable>
      </View>
      <RpePicker visible={rpeOpen} value={rpe} onClose={() => setRpeOpen(false)} onSelect={onPickRpe} />
      {isGripper && (
        <GripPicker
          visible={gripOpen}
          value={meta}
          grippers={grippers}
          onClose={() => setGripOpen(false)}
          onChange={onChangeMeta}
        />
      )}
    </View>
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
  const [removeTarget, setRemoveTarget] = useState<{ ids: string[]; label: string } | null>(null);
  // свёрнутость групп (упражнение или кластер) по ключу; по умолчанию открыт только первый
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', workoutId],
    queryFn: () => getWorkoutDetail(workoutId),
    enabled: !!session,
  });

  const { data: disciplines } = useQuery({
    queryKey: ['disciplines', session?.user.id],
    queryFn: () => getDisciplines(session!.user.id),
    enabled: !!session,
  });

  const { data: grippers } = useQuery({
    queryKey: ['gripper-catalog', session?.user.id],
    queryFn: () => listGripperCatalog(session!.user.id),
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

  // при загрузке тренировки: первый блок/упражнение развёрнут, остальные свёрнуты
  useEffect(() => {
    if (!workout) return;
    const keys: string[] = [];
    for (const we of workout.workout_exercises) {
      const k = isClusteredWorkoutExercise(we) ? we.block_key! : we.id;
      if (!keys.includes(k)) keys.push(k);
    }
    setCollapsed(Object.fromEntries(keys.map((k, i) => [k, i !== 0])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workout?.id]);

  // Структурные мутации тренировки — все по mutationKey; fn+оптимистика живут в defaults на
  // QueryClient (registerWorkoutMutationDefaults), чтобы оффлайн-запись (старт/подходы/добавление/
  // удаление/перестановка/«готово»/завершение) пережила перезапуск и доиграла на реконнекте (SPEC §4).
  const addExerciseMut = useMutation<string, Error, AddWeVars>({ mutationKey: WE_ADD });

  // добавить упражнение в тренировку: оптимистика и доживание — в дефолте WE_ADD; здесь только
  // UI-побочки (закрыть пикер, освежить «недавние») сразу, не дожидаясь сети.
  const addExerciseToWorkout = (ex: Exercise) => {
    addExerciseMut.mutate({
      workoutId,
      id: newId(),
      exerciseId: ex.id,
      orderIndex: workout?.workout_exercises.length ?? 0,
      exercise: ex,
    });
    qc.invalidateQueries({ queryKey: ['exercises-recent'] });
    setPickerOpen(false);
  };

  // создание кастомного упражнения — серверная операция (каталог), осознанно online-only;
  // после создания добавляем его в тренировку уже durable-путём.
  const createExerciseMut = useMutation({
    mutationFn: (name: string) => createCustomExercise(session!.user.id, name),
    onSuccess: (ex) => {
      qc.invalidateQueries({ queryKey: ['exercises-all'] });
      addExerciseToWorkout(ex);
    },
    onError: (e: Error) => {
      Alert.alert(
        '',
        e.message === 'exercise_daily_cap' ? t('workout.customCapped') : t('programs.errGeneric'),
      );
    },
  });

  const enableDisciplineMut = useMutation({
    mutationFn: (d: Parameters<typeof enableDiscipline>[1]) =>
      enableDiscipline(session!.user.id, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['disciplines', session?.user.id] }),
  });

  // выбор упражнения: если оно из ещё не включённой дисциплины — тихо включаем её словник
  const onPickExercise = (ex: Exercise) => {
    const d = disciplineToEnable(ex, disciplines ?? []);
    if (d) enableDisciplineMut.mutate(d);
    addExerciseToWorkout(ex);
  };

  const addSetMut = useMutation<SetRowType, Error, AddSetVars>({ mutationKey: SET_ADD });
  const updateSetMut = useMutation<void, Error, UpdateSetVars>({ mutationKey: SET_UPDATE });
  const deleteSetMut = useMutation<void, Error, DeleteSetVars>({ mutationKey: SET_DELETE });

  // убрать упражнение/блок из тренировки целиком (для кластера — все его упражнения)
  const removeExerciseMut = useMutation<void, Error, RemoveWeVars>({ mutationKey: WE_REMOVE });

  const moveWorkoutExMut = useMutation<void, Error, ReorderWeVars>({ mutationKey: WE_REORDER });
  // переставить упражнение внутри кластера на dir (-1 вверх / +1 вниз).
  // order_index в тренировке глобальный → переиспользуем существующие слоты группы (не 0..n-1).
  const moveClusterItem = (items: WorkoutExercise[], i: number, dir: number) => {
    const target = i + dir;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((e) => e.id);
    [ids[i], ids[target]] = [ids[target], ids[i]];
    const orders = items.map((e) => e.order_index).sort((a, b) => a - b);
    moveWorkoutExMut.mutate({ workoutId, ids, orders });
  };

  const setLoggedMut = useMutation<void, Error, LogSetVars>({ mutationKey: SET_LOG });

  const finishExerciseMut = useMutation<void, Error, DoneWeVars>({ mutationKey: WE_DONE });

  // отметить/снять «подход сделан»; при отметке отдых = разрыв с прошлым сделанным.
  // Авто-отдых по настенным часам осмыслен ТОЛЬКО в живой тренировке. При правке завершённой
  // (есть ended_at) переотметка идёт «сегодня» → разрыв с подходом недельной давности = бред
  // («бешеное время отдыха»). В этом случае не пересчитываем, а сохраняем уже записанный rest_sec.
  // авто-отметка при вводе значения: помечаем «зроблено» БЕЗ пересчёта отдыха (отдых —
  // осознанное действие через ✓/RPE). Идемпотентно: если уже logged — не трогаем.
  const markSetLogged = (set: SetRowType) => {
    if (!set.logged_at) setLoggedMut.mutate({ workoutId, id: set.id, logged: true, restSec: null });
  };
  const onToggleDone = (set: SetRowType) => {
    const logged = !!set.logged_at;
    const live = !workout?.ended_at;
    const rest = !logged
      ? live && anchor
        ? Math.max(0, Math.round((Date.now() - anchor) / 1000))
        : set.rest_sec
      : null;
    setLoggedMut.mutate({ workoutId, id: set.id, logged: !logged, restSec: rest });
  };

  // Завершить тренировку: запись (ended_at + оптимистика + доживание) — в дефолте WORKOUT_FINISH;
  // на сводку уходим СРАЗУ, не дожидаясь сети (offline-first), как старт тренировки.
  const finishMut = useMutation<void, Error, FinishVars>({ mutationKey: WORKOUT_FINISH });
  // любое «завершення» (тренування/вправу/кластер) сначала блюрит сфокусированный инпут →
  // onEndEditing→save (durable) успевает записать последнее введённое, потом уже действие.
  // Иначе значение в фокусе терялось при коллапсе/навигации (как отмечал Сергей).
  const flushThen = (fn: () => void) => {
    Keyboard.dismiss();
    requestAnimationFrame(fn);
  };
  const onFinish = () => {
    flushThen(() => {
      finishMut.mutate({ workoutId });
      router.replace({ pathname: '/summary/[id]', params: { id: workoutId } });
    });
  };

  // одно упражнение-карточка (свёрнутая/развёрнутая). nested — внутри кластера (другой фон).
  const exName = (we: WorkoutExercise) =>
    // сматченное упражнение → локализованное имя из каталога (следует uk/en);
    // кастомное/несматченное → имя как в программе (display_name)
    we.exercise ? exerciseName(we.exercise, lang) : (we.display_name ?? '—');

  const renderExercise = (we: WorkoutExercise) => {
    const key = we.id;
    const isCollapsed = !!collapsed[key];
    const name = exName(we);
    const doneSets = we.sets.filter((s) => s.logged_at);
    const best = doneSets.reduce<SetRowType | null>(
      (b, s) => ((s.weight ?? 0) > (b?.weight ?? -1) ? s : b),
      null,
    );

    if (isCollapsed) {
      const sub = doneSets.length
        ? `${setsLabel(doneSets.length)}${
            best?.weight != null
              ? ` · ${formatWeight(best.weight, unit)} ${t(`common.${unit}`)}${best.reps != null ? ` × ${best.reps}` : ''}`
              : ''
          }`
        : setsLabel(we.sets.length);
      return (
        <Pressable
          key={key}
          onPress={() => setCollapsed((c) => ({ ...c, [key]: false }))}
          className="flex-row items-center justify-between rounded-2xl bg-graphite-900 p-4 active:opacity-80"
        >
          <View className="flex-1">
            <Text className="text-base font-bold text-graphite-100">{name}</Text>
            <Text className="mt-0.5 text-xs text-graphite-500">{sub}</Text>
          </View>
          <Text className="ml-2 text-base text-accent">{we.done_at ? '✓' : '▼'}</Text>
        </Pressable>
      );
    }

    return (
      <View key={key} className="rounded-2xl bg-graphite-900 p-4">
        <View className="flex-row items-center">
          <Pressable
            onPress={() => setCollapsed((c) => ({ ...c, [key]: true }))}
            className="flex-1 flex-row items-center justify-between active:opacity-80"
          >
            <Text className="flex-1 text-base font-bold text-graphite-50">{name}</Text>
            <Text className="ml-2 text-graphite-500">▲</Text>
          </Pressable>
          <Pressable
            onPress={() => setRemoveTarget({ ids: [we.id], label: name })}
            hitSlop={8}
            className="ml-3 active:opacity-60"
          >
            <Text className="text-graphite-600">✕</Text>
          </Pressable>
        </View>
        {we.sets.map((s, i) => (
          <SetRow
            key={s.id}
            index={i + 1}
            set={s}
            unit={unit}
            metric={we.exercise?.metric ?? 'reps'}
            logKind={we.exercise?.log_kind ?? null}
            grippers={grippers ?? []}
            sided={exerciseSided(we.exercise, we.display_name)}
            locked={!!we.done_at}
            onSave={(setId, input) => updateSetMut.mutate({ workoutId, id: setId, input })}
            onToggleDone={onToggleDone}
            onAutoLog={markSetLogged}
            onDelete={(setId) => deleteSetMut.mutate({ workoutId, setId })}
          />
        ))}
        <View className="mt-3 flex-row gap-2">
          {!we.done_at && (
            <Pressable
              disabled={addSetMut.isPending}
              onPress={() => addSetMut.mutate({ workoutId, weId: we.id, input: {}, id: newId() })}
              className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
            >
              <Text className="text-sm font-semibold text-graphite-200">{t('workout.addSet')}</Text>
            </Pressable>
          )}
          {we.done_at ? (
            <Pressable
              onPress={() => finishExerciseMut.mutate({ workoutId, weId: we.id, done: false })}
              className="flex-1 items-center rounded-xl bg-graphite-800 py-3 active:opacity-80"
            >
              <Text className="text-sm font-bold text-graphite-100">{t('workout.reopenExercise')}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() =>
                flushThen(() => {
                  finishExerciseMut.mutate({ workoutId, weId: we.id, done: true });
                  setCollapsed((c) => ({ ...c, [key]: true }));
                })
              }
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
    const isCollapsed = !!collapsed[g.key];
    const totalSets = g.items.reduce((n, it) => n + it.sets.length, 0);
    const doneSets = g.items.reduce((n, it) => n + it.sets.filter((s) => s.logged_at).length, 0);
    const maxRounds = g.items.reduce((m, it) => Math.max(m, it.sets.length), 0);
    const allDone = g.items.length > 0 && g.items.every((it) => it.done_at);
    const isEmom = (g.type === 'emom' || g.type === 'e2mom') && !!g.intervalSec;

    return (
      <View key={g.key} className="rounded-2xl bg-graphite-900 p-3">
        <View className="flex-row items-center border-l-2 border-accent">
          <Pressable
            onPress={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
            className="flex-1 flex-row items-center justify-between px-3 py-1 active:opacity-80"
          >
            <View className="flex-1">
              <Text className="text-sm font-extrabold uppercase tracking-wide text-accent">
                {g.label || t('blockTypes.rounds')}
              </Text>
              {g.rounds ? <Text className="mt-0.5 text-xs text-graphite-400">{g.rounds}×</Text> : null}
            </View>
            <Text className="ml-2 text-graphite-500">{isCollapsed ? '▼' : '▲'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setRemoveTarget({ ids: g.items.map((it) => it.id), label: g.label || t('blockTypes.rounds') })}
            hitSlop={8}
            className="px-3 py-1 active:opacity-60"
          >
            <Text className="text-graphite-600">✕</Text>
          </Pressable>
        </View>

        {isCollapsed ? (
          <Text className="px-3 pt-2 text-xs text-graphite-500">
            {doneSets}/{totalSets} ✓
          </Text>
        ) : (
          <View className="mt-2">
            {isEmom && <EmomTimer intervalSec={g.intervalSec!} />}
            {g.items.length > 1 && !allDone && (
              <View className="mb-3 rounded-xl bg-graphite-800 p-2">
                <Text className="mb-1 px-1 text-[10px] uppercase tracking-wide text-graphite-500">
                  {t('workout.blockExercises')}
                </Text>
                {g.items.map((it, i) => (
                  <View key={it.id} className="flex-row items-center justify-between py-1">
                    <Text className="flex-1 text-sm text-graphite-200" numberOfLines={1}>
                      {exName(it)}
                    </Text>
                    <View className="flex-row items-center gap-1">
                      <Pressable
                        disabled={i === 0}
                        onPress={() => moveClusterItem(g.items, i, -1)}
                        hitSlop={6}
                        className="px-1"
                        style={{ opacity: i === 0 ? 0.3 : 1 }}
                      >
                        <Text className="text-base text-graphite-300">↑</Text>
                      </Pressable>
                      <Pressable
                        disabled={i === g.items.length - 1}
                        onPress={() => moveClusterItem(g.items, i, 1)}
                        hitSlop={6}
                        className="px-1"
                        style={{ opacity: i === g.items.length - 1 ? 0.3 : 1 }}
                      >
                        <Text className="text-base text-graphite-300">↓</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setRemoveTarget({ ids: [it.id], label: exName(it) })}
                        hitSlop={6}
                        className="ml-1 px-1"
                      >
                        <Text className="text-base text-red-400">✕</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
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
                        metric={it.exercise?.metric ?? 'reps'}
                        logKind={it.exercise?.log_kind ?? null}
                        grippers={grippers ?? []}
                        headerLabel={exName(it)}
                        sided={exerciseSided(it.exercise, it.display_name)}
                        locked={allDone}
                        onSave={(setId, input) => updateSetMut.mutate({ workoutId, id: setId, input })}
                        onToggleDone={onToggleDone}
                        onAutoLog={markSetLogged}
                        onDelete={(setId) => deleteSetMut.mutate({ workoutId, setId })}
                      />
                    );
                  })}
                </View>
              </View>
            ))}
            <View className="mt-1 flex-row gap-2">
              {!allDone && (
                <Pressable
                  disabled={addSetMut.isPending}
                  onPress={() => g.items.forEach((it) => addSetMut.mutate({ workoutId, weId: it.id, input: {}, id: newId() }))}
                  className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
                >
                  <Text className="text-sm font-semibold text-graphite-200">{t('workout.addRound')}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() =>
                  flushThen(() => {
                    const done = !allDone;
                    g.items.forEach((it) => finishExerciseMut.mutate({ workoutId, weId: it.id, done }));
                    setCollapsed((c) => ({ ...c, [g.key]: done }));
                  })
                }
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

  // группируем подряд идущие упражнения одного НАСТОЯЩЕГО кластера (суперсет/круг/EMOM);
  // «single»-блок — каждое упражнение отдельной карточкой (не схлопываем подходы вместе)
  const wgroups: WGroup[] = [];
  for (const we of workout?.workout_exercises ?? []) {
    const last = wgroups[wgroups.length - 1];
    const clustered = isClusteredWorkoutExercise(we);
    if (clustered && last && last.key === we.block_key) last.items.push(we);
    else if (clustered)
      wgroups.push({
        key: we.block_key!,
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
          <Pressable onPress={onFinish} hitSlop={8}>
            <Text className="text-sm font-bold text-accent">{t('workout.finish')}</Text>
          </Pressable>
        </View>

        <ElapsedTimer startedAt={workout.started_at} endedAt={workout.ended_at} />
        <SyncStatus />
        {!workout.ended_at && <RestNow anchor={anchor} />}

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
            const isCluster = g.type != null && g.type !== 'single';
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
        disciplines={disciplines ?? []}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickExercise}
        onCreate={(name) => createExerciseMut.mutate(name)}
        creating={createExerciseMut.isPending}
      />

      <ConfirmDialog
        visible={!!removeTarget}
        title={t('workout.removeTitle')}
        message={removeTarget?.label}
        confirmLabel={t('workout.remove')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (removeTarget) removeExerciseMut.mutate({ workoutId, ids: removeTarget.ids });
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </SafeAreaView>
  );
}
