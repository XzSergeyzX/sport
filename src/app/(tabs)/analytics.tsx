import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsButton } from '@/components/settings-button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  type AnalyticsSummary,
  type AnalyticsWorkout,
  getAnalyticsSummary,
} from '@/lib/db/analytics';
import {
  type CyclePhase,
  getPeriodStarts,
  getTrackCycle,
  logPeriodStart,
  phaseForDate,
} from '@/lib/db/cycle';
import { type Cluster, CLUSTER_ORDER, clusterKey, exerciseName } from '@/lib/db/exercises';
import { getSnapshotsRange, type HealthSnapshot } from '@/lib/db/oura';
import i18n from '@/lib/i18n';
import { useTabBarHeight } from '@/lib/tab-bar';
import { formatWeight, fromKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';

// стабильная пустышка, чтобы memo не пересчитывался на каждом рендере до прихода данных
const EMPTY_SUMMARY: AnalyticsSummary = { workouts: [], rep_records: [], time_records: [], grip_records: [] };

type TonnagePoint = { date: string; tonnage: number };
type RepRec = { kind: 'reps'; weight: number; reps: number; oneRm: number; date: string; cheat?: boolean };
type TimeRec = { kind: 'time'; sec: number; weight: number | null; date: string; cheat?: boolean };
// рекорд хвата: оценка 1ПМ по RGC эспандера, отдельно по виду установки (карта≠дип-сет≠блок≠TNS)
type GripRec = {
  setType: string;
  gripperName: string;
  reps: number;
  estKg: number | null;
  rgcKg: number | null; // от чего считается оценка (RGC эспандера в кг)
  date: string;
};
// секція рекордів хвата: топ-3 на кожен вид установки (дип-сет/блоки/карта/TNS …)
type GripGroup = { setType: string; top: GripRec[]; headline: number };
// одно упражнение может нести ОБА вида рекордов: вес×повторы и время-с-весом
// (натяжка: часть подходов на повторы, часть — статика). Показываем оба, повторы — выше.
type ExRecords = {
  id: string;
  name: string;
  cluster: Cluster | null;
  reps: RepRec[];
  time: TimeRec[];
  headline: number;
  // 'timeWeight' = взвешенное удержание (щипковый хват): рекорд = макс ВЕС, не длительность
  headlineKind: 'reps' | 'time' | 'timeWeight';
};
type RecordGroup = { cluster: Cluster | null; exercises: ExRecords[] };

// Метрики считаются в SQL (RPC get_analytics_summary) — тут только раскладка готовых
// агрегатов под структуру UI: серия тоннажа, группы рекордов по кластерам, секции хвата.
type NamedRow = {
  exercise_id: string | null;
  name_en: string | null;
  name_uk: string | null;
  display_name: string | null;
  cluster: Cluster | null;
};
const rowKey = (r: NamedRow) => r.exercise_id ?? `dn:${r.display_name ?? '—'}`;
const rowName = (r: NamedRow, lang: string) =>
  r.name_en != null && r.name_uk != null
    ? exerciseName({ name_en: r.name_en, name_uk: r.name_uk }, lang)
    : (r.display_name ?? '—');

function analyze(sum: AnalyticsSummary, lang: string) {
  // серия тоннажа: только тренировки с силовыми подходами (тоннаж > 0) — как раньше
  const tonnageSeries: TonnagePoint[] = sum.workouts
    .filter((w) => w.tonnage > 0)
    .map((w) => ({ date: w.started_at, tonnage: w.tonnage }));
  const totalTonnage = tonnageSeries.reduce((n, p) => n + p.tonnage, 0);
  const totalSets = sum.workouts.reduce((n, w) => n + w.set_count, 0);
  const totalMin = sum.workouts.reduce(
    (n, w) =>
      n +
      (w.ended_at
        ? Math.max(0, Math.round((+new Date(w.ended_at) - +new Date(w.started_at)) / 60000))
        : 0),
    0,
  );

  // рекорды: строки уже топ-5 на упражнение и отсортированы в SQL — только группируем
  const exMap = new Map<string, ExRecords>();
  const acc = (r: NamedRow): ExRecords => {
    const key = rowKey(r);
    let ex = exMap.get(key);
    if (!ex) {
      ex = {
        id: key,
        name: rowName(r, lang),
        cluster: r.cluster,
        reps: [],
        time: [],
        headline: 0,
        headlineKind: 'reps',
      };
      exMap.set(key, ex);
    }
    return ex;
  };
  for (const r of sum.rep_records)
    acc(r).reps.push({ kind: 'reps', weight: r.weight, reps: r.reps, oneRm: r.one_rm, date: r.date, cheat: r.cheat });
  for (const r of sum.time_records)
    acc(r).time.push({ kind: 'time', sec: r.sec, weight: r.weight, date: r.date, cheat: r.cheat });

  const exList: ExRecords[] = [];
  for (const ex of exMap.values()) {
    if (ex.reps.length === 0 && ex.time.length === 0) continue;
    // заголовок: приоритет вес×повторы (1ПМ); иначе взвешенное удержание → макс вес; иначе время
    const timeWeighted = ex.time.length > 0 && ex.time[0].weight != null;
    ex.headlineKind = ex.reps.length ? 'reps' : timeWeighted ? 'timeWeight' : 'time';
    ex.headline = ex.reps.length
      ? ex.reps[0].oneRm
      : timeWeighted
        ? (ex.time[0].weight as number)
        : ex.time[0].sec;
    exList.push(ex);
  }

  const order: (Cluster | null)[] = [...CLUSTER_ORDER, null];
  const recordGroups: RecordGroup[] = order
    .map((c) => ({
      cluster: c,
      exercises: exList
        .filter((e) => e.cluster === c)
        // порядок видов: вес×повторы → взвешенное удержание → чистое время; внутри — по заголовку
        .sort((a, b) => {
          const rank = (k: ExRecords['headlineKind']) =>
            k === 'reps' ? 0 : k === 'timeWeight' ? 1 : 2;
          return rank(a.headlineKind) - rank(b.headlineKind) || b.headline - a.headline;
        }),
    }))
    .filter((g) => g.exercises.length > 0);

  // грип-рекорды: топ-3 на вид установки уже посчитаны и отсортированы в SQL
  const gripBuckets = new Map<string, GripRec[]>();
  for (const r of sum.grip_records) {
    const rec: GripRec = {
      setType: r.set_type,
      gripperName: r.gripper_name ?? '—',
      reps: r.reps,
      estKg: r.est_kg,
      rgcKg: r.rgc_kg,
      date: r.date,
    };
    const bucket = gripBuckets.get(r.set_type);
    if (bucket) bucket.push(rec);
    else gripBuckets.set(r.set_type, [rec]);
  }
  const gripGroups: GripGroup[] = [...gripBuckets.entries()]
    .map(([setType, top]) => ({ setType, top, headline: top[0]?.estKg ?? -1 }))
    .filter((g) => g.top.length > 0)
    .sort((a, b) => b.headline - a.headline);

  return {
    tonnageSeries,
    recordGroups,
    gripGroups,
    totalTonnage,
    totalSets,
    totalMin,
    workouts: sum.workouts.length,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function fmtDuration(min: number, t: (k: string) => string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} ${t('analytics.hrShort')} ${m} ${t('summary.min')}` : `${m} ${t('summary.min')}`;
}
function fmtTonnage(v: number): string {
  // суффикс тысяч локализован: «40.1к» в укр-интерфейсе, «40.1k» в en
  return v >= 1000 ? `${(v / 1000).toFixed(1)}${i18n.t('common.thousandSuffix')}` : String(Math.round(v));
}
function fmtSec(sec: number, secShort: string): string {
  if (sec < 60) return `${sec}${secShort}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
// дд.мм.гг с ведущими нулями — единый формат дат по всей апке (как в списке тренировок)
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

// ——— OURA «Відновлення»: середні за 30 днів + спарклайн + дельта до попередніх 30 ———

function ymdDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

// dir: 1 = чем больше тем лучше, -1 = чем меньше тем лучше, 0 = нейтрально (только тренд)
type RecoverySpec = {
  key: string;
  unit?: string;
  get: (s: HealthSnapshot) => number | null;
  fmt: (v: number) => string;
  dir: 1 | -1 | 0;
};
const r0 = (v: number) => String(Math.round(v));
const r1 = (v: number) => v.toFixed(1);
const RECOVERY_SPECS: RecoverySpec[] = [
  { key: 'readiness', get: (s) => s.readiness, fmt: r0, dir: 1 },
  { key: 'sleep', get: (s) => s.sleep_score, fmt: r0, dir: 1 },
  { key: 'hrv', unit: 'ms', get: (s) => s.hrv, fmt: r0, dir: 1 },
  { key: 'rhr', unit: 'bpm', get: (s) => s.rhr, fmt: r0, dir: -1 },
  { key: 'duration', unit: 'h', get: (s) => s.sleep_total_min, fmt: fmtClock, dir: 1 },
  { key: 'efficiency', unit: 'pct', get: (s) => s.sleep_efficiency, fmt: r0, dir: 1 },
  { key: 'respiratory', unit: 'brmin', get: (s) => s.respiratory_rate, fmt: r1, dir: 0 },
  { key: 'temp', unit: 'c', get: (s) => s.temp, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, dir: 0 },
  { key: 'spo2', unit: 'pct', get: (s) => s.spo2_avg, fmt: r1, dir: 1 },
  { key: 'stress', unit: 'min', get: (s) => s.stress_high_min, fmt: r0, dir: -1 },
  { key: 'steps', get: (s) => s.steps, fmt: r0, dir: 1 },
];

type RecoveryMetric = {
  key: string;
  unit?: string;
  dir: 1 | -1 | 0;
  latest: string;
  avg: string;
  spark: number[];
  deltaPct: number | null;
};

const SPARK_BARS = 28;
// длинный ряд → ~28 бакетов (среднее по бакету), чтобы спарклайн читался на любом периоде
function downsample(vals: number[], buckets = SPARK_BARS): number[] {
  if (vals.length <= buckets) return vals;
  const out: number[] = [];
  const size = vals.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor(i * size);
    const b = Math.max(Math.floor((i + 1) * size), a + 1);
    const slice = vals.slice(a, b);
    out.push(slice.reduce((n, v) => n + v, 0) / slice.length);
  }
  return out;
}

// snaps — отсортированы по дате asc (getSnapshotsRange). rangeDays — выбранное окно.
function analyzeRecovery(snaps: HealthSnapshot[], rangeDays: number): RecoveryMetric[] {
  const curFrom = ymdDaysAgo(rangeDays - 1);
  const prevFrom = ymdDaysAgo(rangeDays * 2 - 1);
  const mean = (xs: number[]) => xs.reduce((n, v) => n + v, 0) / xs.length;
  const out: RecoveryMetric[] = [];
  for (const spec of RECOVERY_SPECS) {
    const pts = snaps
      .map((s) => ({ date: s.date, v: spec.get(s) }))
      .filter((p): p is { date: string; v: number } => p.v != null);
    if (pts.length < 3) continue;
    const cur = pts.filter((p) => p.date >= curFrom);
    if (cur.length === 0) continue;
    const prev = pts.filter((p) => p.date >= prevFrom && p.date < curFrom);
    const avg = mean(cur.map((p) => p.v));
    const prevAvg = prev.length ? mean(prev.map((p) => p.v)) : null;
    const deltaPct =
      prevAvg != null && prevAvg !== 0 ? ((avg - prevAvg) / Math.abs(prevAvg)) * 100 : null;
    out.push({
      key: spec.key,
      unit: spec.unit,
      dir: spec.dir,
      latest: spec.fmt(pts[pts.length - 1].v),
      avg: spec.fmt(avg),
      spark: downsample(cur.map((p) => p.v)),
      deltaPct,
    });
  }
  return out;
}

function Sparkline({ data }: { data: number[] }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return (
    <View className="mt-2 h-7 flex-row items-end gap-px">
      {data.map((v, i) => (
        <View
          key={i}
          className="flex-1 rounded-sm bg-accent/70"
          style={{ height: Math.max(2, ((v - min) / range) * 28) }}
        />
      ))}
    </View>
  );
}

function RecoveryCard({ m }: { m: RecoveryMetric }) {
  const { t } = useTranslation();
  // % показываем только у метрик с понятным «лучше/хуже» (dir≠0) и ненулевой базой;
  // у температуры/дыхания база ~0 → процент бессмысленный (даёт «134%»), оставляем только тренд.
  const showDelta = m.deltaPct != null && m.dir !== 0 && m.deltaPct !== 0;
  const good = m.deltaPct != null && (m.deltaPct > 0 ? m.dir === 1 : m.dir === -1);
  return (
    <View className="mb-3 w-[48%] rounded-2xl bg-graphite-900 p-4">
      <Text className="text-xs text-graphite-400" numberOfLines={1}>
        {t(`health.metrics.${m.key}`)}
      </Text>
      <View className="mt-1 flex-row items-baseline">
        <Text className="text-2xl font-extrabold text-graphite-50">{m.latest}</Text>
        {m.unit ? (
          <Text className="ml-1 text-xs text-graphite-500">{t(`health.units.${m.unit}`)}</Text>
        ) : null}
      </View>
      <View className="mt-0.5 flex-row items-center justify-between">
        <Text className="text-[11px] text-graphite-500">{t('analytics.avg30', { v: m.avg })}</Text>
        {showDelta ? (
          <Text className={`text-[11px] font-semibold ${good ? 'text-accent' : 'text-red-400'}`}>
            {m.deltaPct! > 0 ? '▲' : '▼'} {Math.abs(Math.round(m.deltaPct!))}%
          </Text>
        ) : null}
      </View>
      <Sparkline data={m.spark} />
    </View>
  );
}

// ——— Кореляція «тренування × відновлення × цикл»: сшиваем по дате ———

function ymdLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type CorrWorkout = {
  id: string;
  date: string;
  tonnage: number;
  avgRpe: number | null;
  readiness: number | null;
  sleep: number | null;
  phase: CyclePhase | null;
};
type Correlation = {
  workouts: CorrWorkout[];
  trainCount: number;
  phaseCounts: Partial<Record<CyclePhase, number>>;
  readinessTrain: number | null;
  readinessAll: number | null;
  sleepTrain: number | null;
  sleepAll: number | null;
};

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((n, v) => n + v, 0) / xs.length : null;
const nums = (xs: (number | null)[]): number[] => xs.filter((v): v is number => v != null);

function analyzeCorrelation(
  wks: AnalyticsWorkout[],
  snaps: HealthSnapshot[],
  starts: string[],
  rangeDays: number,
): Correlation {
  const fromYmd = ymdDaysAgo(rangeDays - 1);
  const snap = new Map<string, HealthSnapshot>();
  for (const s of snaps) snap.set(s.date, s);

  const workouts: CorrWorkout[] = wks
    .map((w) => ({ w, date: ymdLocal(w.started_at) }))
    .filter(({ date }) => date >= fromYmd)
    .map(({ w, date }) => {
      const s = snap.get(date);
      return {
        id: w.id,
        date,
        tonnage: w.tonnage,
        avgRpe: w.avg_rpe,
        readiness: s?.readiness ?? null,
        sleep: s?.sleep_score ?? null,
        phase: phaseForDate(date, starts),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const trainDays = new Set(workouts.map((w) => w.date));
  const inRange = snaps.filter((s) => s.date >= fromYmd);
  const onTrain = inRange.filter((s) => trainDays.has(s.date));

  const phaseCounts: Partial<Record<CyclePhase, number>> = {};
  for (const w of workouts) if (w.phase) phaseCounts[w.phase] = (phaseCounts[w.phase] ?? 0) + 1;

  return {
    workouts,
    trainCount: workouts.length,
    phaseCounts,
    readinessTrain: mean(nums(onTrain.map((s) => s.readiness))),
    readinessAll: mean(nums(inRange.map((s) => s.readiness))),
    sleepTrain: mean(nums(onTrain.map((s) => s.sleep_score))),
    sleepAll: mean(nums(inRange.map((s) => s.sleep_score))),
  };
}

const PHASE_ORDER: CyclePhase[] = ['menstrual', 'follicular', 'ovulation', 'luteal'];

function CompareStat({ label, value, vs }: { label: string; value: string; vs: string | null }) {
  return (
    <View className="flex-1 rounded-2xl bg-graphite-900 p-4">
      <Text className="text-2xl font-extrabold text-graphite-50">{value}</Text>
      <Text className="mt-1 text-xs text-graphite-400">{label}</Text>
      {vs ? <Text className="mt-0.5 text-[11px] text-graphite-600">{vs}</Text> : null}
    </View>
  );
}

// полная дата ДД.ММ.РРРР — читается как день, а не как «параграф» 15.6
function fmtYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function CorrRow({ w, unit, unitLabel }: { w: CorrWorkout; unit: WeightUnit; unitLabel: string }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (w.readiness != null) parts.push(`${t('analytics.readyShort')} ${Math.round(w.readiness)}`);
  if (w.sleep != null) parts.push(`${t('analytics.sleepShort')} ${Math.round(w.sleep)}`);
  if (w.avgRpe != null) parts.push(`RPE ${w.avgRpe.toFixed(1)}`);
  if (w.tonnage > 0) parts.push(`${fmtTonnage(fromKg(w.tonnage, unit) ?? 0)} ${unitLabel}`);
  return (
    <View className="flex-row items-center justify-between border-t border-graphite-800 py-2">
      <View className="w-28">
        <Text className="text-sm font-semibold text-graphite-100">{fmtYmd(w.date)}</Text>
        {w.phase ? (
          <Text className="text-[10px] text-accent" numberOfLines={1}>
            {t(`health.cycle.phase.${w.phase}`)}
          </Text>
        ) : null}
      </View>
      <Text className="ml-2 flex-1 text-right text-xs text-graphite-400" numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-graphite-900 p-4">
      <Text className="text-2xl font-extrabold text-graphite-50">{value}</Text>
      <Text className="mt-1 text-xs uppercase tracking-wide text-graphite-500">{label}</Text>
    </View>
  );
}

function TonnageBars({ series, unit, hint }: { series: TonnagePoint[]; unit: string; hint: string }) {
  const last = series.slice(-12);
  const max = Math.max(1, ...last.map((p) => p.tonnage));
  return (
    <View className="rounded-2xl bg-graphite-900 p-4">
      <View className="h-32 flex-row items-end gap-1.5">
        {last.map((p, i) => (
          <View key={`${p.date}-${i}`} className="flex-1 items-center justify-end">
            <Text className="mb-0.5 text-[9px] font-semibold text-graphite-400">
              {fmtTonnage(p.tonnage)}
            </Text>
            <View
              className="w-full rounded-t-md bg-accent"
              style={{ height: Math.max(4, (p.tonnage / max) * 90) }}
            />
          </View>
        ))}
      </View>
      <View className="mt-1 flex-row gap-1.5">
        {last.map((p, i) => {
          const d = new Date(p.date);
          return (
            <Text key={`${p.date}-${i}`} className="flex-1 text-center text-[9px] text-graphite-600">
              {pad2(d.getDate())}.{pad2(d.getMonth() + 1)}
            </Text>
          );
        })}
      </View>
      <Text className="mt-2 text-center text-[10px] text-graphite-600">
        {hint} · {unit}
      </Text>
    </View>
  );
}

// ——— Календар: тренування + готовність + фаза по днях, тап → деталі / відмітка «день 1» ———

type DayInfo = {
  workout: boolean;
  workoutIds: string[]; // тап у модалке дня → открыть summary тренировки
  tonnage: number;
  readiness: number | null;
  sleep: number | null;
  phase: CyclePhase | null;
};

const PHASE_TINT: Record<CyclePhase, string> = {
  menstrual: 'bg-red-500/25',
  follicular: 'bg-accent/20',
  ovulation: 'bg-sky-500/25',
  luteal: 'bg-amber-500/25',
};

function Calendar({
  monthOffset,
  info,
  starts,
  showPhases,
  onPrev,
  onNext,
  onSelectDay,
}: {
  monthOffset: number;
  info: Map<string, DayInfo>;
  starts: Set<string>;
  showPhases: boolean; // фазы цикла — только если пользователь трекает цикл
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (ymd: string) => void;
}) {
  const { t } = useTranslation();
  const locale = i18n.language === 'uk' ? 'uk-UA' : 'en-US';
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  // месяц + голый год: локализованный year:'numeric' даёт «2026 р.», которое капслочится в «Р.»
  const title = `${base.toLocaleDateString(locale, { month: 'long' })} ${year}`;
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // понеділок = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const week = [...Array(7)].map((_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
  );
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`);

  return (
    <View className="rounded-2xl bg-graphite-900 p-3">
      <View className="flex-row items-center justify-between px-1 pb-2">
        <Pressable onPress={onPrev} hitSlop={12} className="px-2 active:opacity-60">
          <Text className="text-lg text-graphite-300">‹</Text>
        </Pressable>
        <Text className="text-sm font-semibold capitalize text-graphite-100">{title}</Text>
        <Pressable onPress={onNext} hitSlop={12} className="px-2 active:opacity-60">
          <Text className="text-lg text-graphite-300">›</Text>
        </Pressable>
      </View>
      <View className="flex-row">
        {week.map((w, i) => (
          <Text key={i} className="flex-1 text-center text-[10px] uppercase text-graphite-600">
            {w}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {cells.map((ymd, i) => {
          if (!ymd)
            return (
              <View key={`b${i}`} className="w-[14.28%] p-0.5">
                <View className="h-11" />
              </View>
            );
          const di = info.get(ymd);
          const tint = showPhases && di?.phase ? PHASE_TINT[di.phase] : 'bg-graphite-800';
          const day = Number(ymd.split('-')[2]);
          return (
            <View key={ymd} className="w-[14.28%] p-0.5">
              <Pressable
                onPress={() => onSelectDay(ymd)}
                className={`h-11 items-center justify-center rounded-lg ${tint} active:opacity-70 ${starts.has(ymd) ? 'border border-red-400' : ''}`}
              >
                <Text className="text-xs text-graphite-100">{day}</Text>
                <View
                  className={`mt-0.5 h-1.5 w-1.5 rounded-full ${di?.workout ? 'bg-accent' : ''}`}
                />
              </Pressable>
            </View>
          );
        })}
      </View>
      <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <View className="flex-row items-center gap-1">
          <View className="h-1.5 w-1.5 rounded-full bg-accent" />
          <Text className="text-[10px] text-graphite-500">{t('analytics.workoutYes')}</Text>
        </View>
        {showPhases &&
          PHASE_ORDER.map((p) => (
            <View key={p} className="flex-row items-center gap-1">
              <View className={`h-2.5 w-2.5 rounded-sm ${PHASE_TINT[p]}`} />
              <Text className="text-[10px] text-graphite-500">{t(`health.cycle.phase.${p}`)}</Text>
            </View>
          ))}
      </View>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-sm text-graphite-400">{label}</Text>
      <Text className="text-sm font-semibold text-graphite-100">{value}</Text>
    </View>
  );
}

export default function AnalyticsScreen() {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const lang = i18n.language;
  const { session } = useAuth();
  const userId = session?.user.id;
  const tabBarHeight = useTabBarHeight();
  const [openClusters, setOpenClusters] = useState<Record<string, boolean>>({});
  const [openEx, setOpenEx] = useState<Record<string, boolean>>({});
  const [range, setRange] = useState<number>(30);

  // ключ иерархический: ['analytics', ...] — мутации (финиш/удаление/импорт тренировки,
  // замена упражнения) инвалидируют префиксом ['analytics'] всю сводку разом
  const { data: summary, isLoading } = useQuery({
    queryKey: ['analytics', 'summary', userId],
    queryFn: () => getAnalyticsSummary(),
    enabled: !!userId,
  });

  const { data: snaps } = useQuery({
    queryKey: ['analytics-recovery', userId],
    queryFn: () => getSnapshotsRange(userId as string, ymdDaysAgo(365)),
    enabled: !!userId,
  });

  const { data: cycleStarts } = useQuery({
    queryKey: ['analytics-cycle-starts', userId],
    queryFn: () => getPeriodStarts(userId as string),
    enabled: !!userId,
  });

  const qc = useQueryClient();
  const router = useRouter();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
  });

  const markMut = useMutation({
    mutationFn: (day: string) => logPeriodStart(userId as string, day),
    onSuccess: () => {
      setSelectedDay(null);
      qc.invalidateQueries({ queryKey: ['analytics-cycle-starts', userId] });
      qc.invalidateQueries({ queryKey: ['cycle', userId] });
    },
  });

  const a = useMemo(() => analyze(summary ?? EMPTY_SUMMARY, lang), [summary, lang]);
  const recovery = useMemo(() => analyzeRecovery(snaps ?? [], range), [snaps, range]);
  const corr = useMemo(
    () => analyzeCorrelation(summary?.workouts ?? [], snaps ?? [], cycleStarts ?? [], range),
    [summary, snaps, cycleStarts, range],
  );

  const dayInfo = useMemo(() => {
    const starts = cycleStarts ?? [];
    const m = new Map<string, DayInfo>();
    for (const s of snaps ?? [])
      m.set(s.date, {
        workout: false,
        workoutIds: [],
        tonnage: 0,
        readiness: s.readiness,
        sleep: s.sleep_score,
        phase: phaseForDate(s.date, starts),
      });
    for (const w of summary?.workouts ?? []) {
      const d = ymdLocal(w.started_at);
      const e =
        m.get(d) ??
        ({ workout: false, workoutIds: [], tonnage: 0, readiness: null, sleep: null, phase: phaseForDate(d, starts) } as DayInfo);
      e.workout = true;
      if (!e.workoutIds.includes(w.id)) e.workoutIds.push(w.id);
      e.tonnage += w.tonnage;
      m.set(d, e);
    }
    return m;
  }, [snaps, summary, cycleStarts]);
  const startsSet = useMemo(() => new Set(cycleStarts ?? []), [cycleStarts]);
  const unitLabel = t(`common.${unit}`);
  const secShort = t('workout.secShort');

  const recLine = (r: RepRec | TimeRec, i: number) => {
    const left =
      r.kind === 'reps'
        ? `${i + 1}.  ${formatWeight(r.weight, unit)} ${unitLabel} × ${r.reps}`
        : r.weight != null
          ? // взвешенное удержание: ведём вес (это и есть рекорд), затем длительность
            `${i + 1}.  ${formatWeight(r.weight, unit)} ${unitLabel} · ${fmtSec(r.sec, secShort)}`
          : `${i + 1}.  ${fmtSec(r.sec, secShort)}`;
    const right =
      r.kind === 'reps' ? `≈${formatWeight(r.oneRm, unit)} · ${fmtDate(r.date)}` : fmtDate(r.date);
    return (
      <View key={`${r.kind}-${i}`} className="flex-row items-center justify-between py-1">
        <Text className="flex-1 text-sm text-graphite-200" numberOfLines={1}>
          {left}
          {r.cheat ? (
            <Text className="text-xs font-semibold text-amber-500"> · {t('workout.cheat')}</Text>
          ) : null}
        </Text>
        <Text className="ml-2 text-xs text-graphite-500">{right}</Text>
      </View>
    );
  };

  // рядок рекорду хвата — той самий шаблон, що recLine у звичайних вправах («залізка × повтори»
  // зліва, «≈оцінка · дата» справа), щоб секції читались однаково; RGC — дрібним другим рядком
  const gripLine = (r: GripRec, i: number) => (
    <View key={`${r.gripperName}-${r.reps}-${i}`} className="py-1">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm text-graphite-200" numberOfLines={1}>
          {i + 1}.  {r.gripperName} × {r.reps}
        </Text>
        <Text className="ml-2 text-xs text-graphite-500">
          {r.estKg != null ? `≈${formatWeight(r.estKg, unit)} ${unitLabel} · ` : ''}
          {fmtDate(r.date)}
        </Text>
      </View>
      {r.rgcKg != null && (
        <Text className="ml-5 text-xs text-graphite-600" numberOfLines={1}>
          RGC: {formatWeight(r.rgcKg, unit)} {unitLabel}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-extrabold text-graphite-50">{t('analytics.title')}</Text>
          <SettingsButton />
        </View>

        {isLoading ? (
          <View className="mt-10 items-center">
            <ActivityIndicator color="#848D9A" />
          </View>
        ) : a.workouts === 0 && recovery.length === 0 ? (
          <View className="mt-6 rounded-2xl bg-graphite-900 p-5">
            <Text className="text-sm leading-5 text-graphite-400">{t('analytics.empty')}</Text>
          </View>
        ) : (
          <>
            {a.workouts > 0 && (
              <>
            <View className="mt-5 gap-3">
              <View className="flex-row gap-3">
                <Stat label={t('analytics.statWorkouts')} value={String(a.workouts)} />
                <Stat label={`${t('summary.tonnage')}, ${unitLabel}`} value={fmtTonnage(fromKg(a.totalTonnage, unit) ?? 0)} />
              </View>
              <View className="flex-row gap-3">
                <Stat label={t('summary.sets')} value={String(a.totalSets)} />
                <Stat label={t('analytics.statTime')} value={fmtDuration(a.totalMin, t)} />
              </View>
            </View>

            <Text className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
              {t('analytics.tonnageTrend')}
            </Text>
            <TonnageBars
              series={a.tonnageSeries.map((p) => ({ date: p.date, tonnage: fromKg(p.tonnage, unit) ?? 0 }))}
              unit={unitLabel}
              hint={t('analytics.tonnageHint')}
            />

            <Text className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
              {t('analytics.records')}
            </Text>
            <View className="gap-2">
              {a.recordGroups.map((g, gi) => {
                const ckey = g.cluster ?? 'other';
                const cOpen = openClusters[ckey] ?? gi === 0;
                return (
                  <View key={ckey} className="rounded-2xl bg-graphite-900 p-3">
                    <Pressable
                      onPress={() => setOpenClusters((c) => ({ ...c, [ckey]: !cOpen }))}
                      className="flex-row items-center justify-between border-l-2 border-accent px-3 py-1 active:opacity-80"
                    >
                      <Text className="text-sm font-extrabold uppercase tracking-wide text-accent">
                        {t(clusterKey(g.cluster))} · {g.exercises.length}
                      </Text>
                      <Text className="ml-2 text-graphite-500">{cOpen ? '▲' : '▼'}</Text>
                    </Pressable>

                    {cOpen && (
                      <View className="mt-2 gap-1">
                        {g.exercises.map((ex) => {
                          const xOpen = !!openEx[ex.id];
                          const head =
                            ex.headlineKind === 'reps'
                              ? `≈${formatWeight(ex.headline, unit)} ${unitLabel}`
                              : ex.headlineKind === 'timeWeight'
                                ? `${formatWeight(ex.headline, unit)} ${unitLabel}`
                                : fmtSec(ex.headline, secShort);
                          return (
                            <View key={ex.id} className="rounded-xl bg-graphite-800 p-3">
                              <Pressable
                                onPress={() => setOpenEx((e) => ({ ...e, [ex.id]: !xOpen }))}
                                className="flex-row items-center justify-between active:opacity-80"
                              >
                                <Text className="flex-1 text-base font-semibold text-graphite-100" numberOfLines={1}>
                                  {ex.name}
                                </Text>
                                <Text className="ml-2 text-sm font-bold text-accent">{head}</Text>
                                <Text className="ml-2 text-graphite-600">{xOpen ? '▲' : '▼'}</Text>
                              </Pressable>
                              {xOpen && (
                                <View className="mt-2 border-t border-graphite-700 pt-1">
                                  {/* вес×повторы — выше по приоритету; статика-с-весом — ниже */}
                                  {ex.reps.map((r, i) => recLine(r, i))}
                                  {ex.reps.length > 0 && ex.time.length > 0 ? (
                                    <View className="my-1 border-t border-graphite-800" />
                                  ) : null}
                                  {ex.time.map((r, i) => recLine(r, i))}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {a.gripGroups.length > 0 && (
              <>
                <Text className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
                  {t('analytics.gripRecords')}
                </Text>
                <View className="gap-2">
                  {a.gripGroups.map((g) => (
                    <View key={g.setType} className="rounded-2xl bg-graphite-900 p-3">
                      <View className="flex-row items-center justify-between border-l-2 border-accent px-3 py-1">
                        <Text className="text-sm font-extrabold uppercase tracking-wide text-accent">
                          {i18n.exists(`setTypes.${g.setType}`)
                            ? t(`setTypes.${g.setType}`)
                            : t('workout.setType')}
                        </Text>
                        {g.headline > 0 && (
                          <Text className="ml-2 text-sm font-bold text-accent">
                            ≈{formatWeight(g.headline, unit)} {unitLabel}
                          </Text>
                        )}
                      </View>
                      {/* внутренняя карточка bg-800 — как карточки упражнений в обычных рекордах */}
                      <View className="mt-2 rounded-xl bg-graphite-800 p-3">
                        {g.top.map((r, i) => gripLine(r, i))}
                      </View>
                    </View>
                  ))}
                </View>
                <Text className="mt-1 px-1 text-[10px] text-graphite-600">{t('analytics.gripHint')}</Text>
              </>
            )}
              </>
            )}

            {recovery.length > 0 && (
              <>
                <Text className="mb-1 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
                  {t('analytics.recovery')}
                </Text>
                <View className="mb-3 flex-row gap-2">
                  {[30, 90, 180].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setRange(n)}
                      className={`rounded-full px-3 py-1 active:opacity-80 ${range === n ? 'bg-accent' : 'bg-graphite-800'}`}
                    >
                      <Text
                        className={`text-xs font-semibold ${range === n ? 'text-graphite-950' : 'text-graphite-300'}`}
                      >
                        {n} {t('analytics.daysShort')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text className="mb-3 text-xs text-graphite-600">
                  {t('analytics.recoveryHint', { n: range })}
                </Text>
                <View className="flex-row flex-wrap justify-between">
                  {recovery.map((m) => (
                    <RecoveryCard key={m.key} m={m} />
                  ))}
                </View>
              </>
            )}

            {corr.trainCount > 0 && corr.readinessAll != null && (
              <>
                <Text className="mb-1 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
                  {t('analytics.corrTitle')}
                </Text>
                <Text className="mb-3 text-xs text-graphite-600">
                  {t('analytics.recoveryHint', { n: range })}
                </Text>

                <View className="flex-row gap-3">
                  {corr.readinessTrain != null && (
                    <CompareStat
                      label={t('analytics.corrReadinessOnTrain')}
                      value={String(Math.round(corr.readinessTrain))}
                      vs={
                        corr.readinessAll != null
                          ? t('analytics.corrVsAvg', { v: Math.round(corr.readinessAll) })
                          : null
                      }
                    />
                  )}
                  {corr.sleepTrain != null && (
                    <CompareStat
                      label={t('analytics.corrSleepOnTrain')}
                      value={String(Math.round(corr.sleepTrain))}
                      vs={
                        corr.sleepAll != null
                          ? t('analytics.corrVsAvg', { v: Math.round(corr.sleepAll) })
                          : null
                      }
                    />
                  )}
                </View>

                {Object.keys(corr.phaseCounts).length > 0 && (
                  <View className="mt-3 rounded-2xl bg-graphite-900 p-4">
                    <Text className="text-xs uppercase tracking-wide text-graphite-500">
                      {t('analytics.corrPhases')}
                    </Text>
                    <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1">
                      {PHASE_ORDER.filter((p) => corr.phaseCounts[p]).map((p) => (
                        <Text key={p} className="text-sm text-graphite-200">
                          {t(`health.cycle.phase.${p}`)}{' '}
                          <Text className="font-bold text-accent">{corr.phaseCounts[p]}</Text>
                        </Text>
                      ))}
                    </View>
                  </View>
                )}

                <View className="mt-3 rounded-2xl bg-graphite-900 px-4 pb-2 pt-1">
                  {corr.workouts.slice(0, 15).map((w) => (
                    <CorrRow key={w.id} w={w} unit={unit} unitLabel={unitLabel} />
                  ))}
                </View>
              </>
            )}

            <Text className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
              {t('analytics.calendar')}
            </Text>
            <Calendar
              monthOffset={monthOffset}
              info={dayInfo}
              starts={startsSet}
              showPhases={!!trackCycle}
              onPrev={() => setMonthOffset((o) => o - 1)}
              onNext={() => setMonthOffset((o) => Math.min(0, o + 1))}
              onSelectDay={setSelectedDay}
            />
          </>
        )}
      </ScrollView>

      <Modal
        visible={!!selectedDay}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDay(null)}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => setSelectedDay(null)}
        >
          <Pressable onPress={() => {}} className="rounded-t-3xl bg-graphite-900 px-6 pb-10 pt-5">
            {selectedDay
              ? (() => {
                  const di = dayInfo.get(selectedDay);
                  return (
                    <>
                      <Text className="text-xl font-extrabold text-graphite-50">
                        {fmtYmd(selectedDay)}
                      </Text>
                      {trackCycle && di?.phase ? (
                        <Text className="mt-1 text-sm text-accent">
                          {t(`health.cycle.phase.${di.phase}`)}
                        </Text>
                      ) : null}
                      <View className="mt-4">
                        {di?.readiness != null ? (
                          <DetailLine
                            label={t('health.metrics.readiness')}
                            value={String(Math.round(di.readiness))}
                          />
                        ) : null}
                        {di?.sleep != null ? (
                          <DetailLine
                            label={t('health.metrics.sleep')}
                            value={String(Math.round(di.sleep))}
                          />
                        ) : null}
                        {di?.workout ? (
                          <DetailLine
                            label={t('analytics.workoutYes')}
                            value={di.tonnage > 0 ? `${fmtTonnage(fromKg(di.tonnage, unit) ?? 0)} ${unitLabel}` : '✓'}
                          />
                        ) : null}
                        {!di ? (
                          <Text className="text-sm text-graphite-500">{t('analytics.noDataDay')}</Text>
                        ) : null}
                      </View>
                      {/* тап из календаря сразу в summary тренировки этого дня */}
                      {di?.workoutIds.map((wid, i) => (
                        <Pressable
                          key={wid}
                          onPress={() => {
                            setSelectedDay(null);
                            router.push({ pathname: '/summary/[id]', params: { id: wid } });
                          }}
                          className="mt-3 items-center rounded-xl border border-accent py-3 active:opacity-70"
                        >
                          <Text className="text-sm font-bold text-accent">
                            {t('analytics.openWorkout')}
                            {di.workoutIds.length > 1 ? ` ${i + 1}` : ''}
                          </Text>
                        </Pressable>
                      ))}
                      {trackCycle ? (
                        <Pressable
                          disabled={markMut.isPending || startsSet.has(selectedDay)}
                          onPress={() => markMut.mutate(selectedDay)}
                          className="mt-5 items-center rounded-xl bg-accent py-3 active:opacity-80"
                          style={{ opacity: startsSet.has(selectedDay) ? 0.5 : 1 }}
                        >
                          <Text className="text-sm font-bold text-graphite-950">
                            {startsSet.has(selectedDay)
                              ? t('analytics.day1Marked')
                              : t('analytics.markDay1')}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => setSelectedDay(null)}
                        className="mt-2 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
                      >
                        <Text className="text-sm font-semibold text-graphite-200">
                          {t('summary.done')}
                        </Text>
                      </Pressable>
                    </>
                  );
                })()
              : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
