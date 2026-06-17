import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { getLoggedSets, type LoggedSet } from '@/lib/db/analytics';
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
import { useWeightUnit } from '@/lib/use-unit';

// оценка 1ПМ по О'Коннору: вес × (1 + 0.025 × повторы) — честнее (ниже Эпли)
const oneRmEst = (weight: number, reps: number) => weight * (1 + 0.025 * reps);

type TonnagePoint = { date: string; tonnage: number };
type RepRec = { kind: 'reps'; weight: number; reps: number; oneRm: number; date: string; cheat?: boolean };
type TimeRec = { kind: 'time'; sec: number; weight: number | null; date: string; cheat?: boolean };
type ExRecords = {
  id: string;
  name: string;
  cluster: Cluster | null;
  kind: 'reps' | 'time';
  top: (RepRec | TimeRec)[];
  headline: number;
};
type RecordGroup = { cluster: Cluster | null; exercises: ExRecords[] };

type Acc = {
  name: string;
  cluster: Cluster | null;
  reps: Map<string, RepRec>;
  time: Map<string, TimeRec>;
};

function analyze(rows: LoggedSet[], lang: string) {
  const exMap = new Map<string, Acc>();
  const wkTonnage = new Map<string, TonnagePoint>();
  const wkDur = new Map<string, number>(); // минуты на тренировку
  const wkSet = new Set<string>();
  let totalSets = 0;

  for (const r of rows) {
    const we = r.workout_exercises;
    const wk = we?.workouts;
    if (!we || !wk) continue;
    const date = wk.started_at;
    wkSet.add(wk.id);
    if (!wkDur.has(wk.id)) {
      wkDur.set(
        wk.id,
        wk.ended_at ? Math.max(0, Math.round((+new Date(wk.ended_at) - +new Date(date)) / 60000)) : 0,
      );
    }
    const name = we.exercises ? exerciseName(we.exercises, lang) : (we.display_name ?? '—');
    const cluster = we.exercises?.cluster ?? null;
    let ex = exMap.get(we.exercise_id);
    if (!ex) {
      ex = { name, cluster, reps: new Map(), time: new Map() };
      exMap.set(we.exercise_id, ex);
    } else {
      ex.name = name;
      if (cluster) ex.cluster = cluster;
    }

    totalSets += 1;
    const cheat = Boolean((r.meta as { cheat?: boolean } | null)?.cheat);
    if (r.duration_sec != null) {
      const key = `${r.duration_sec}@${r.weight ?? ''}`;
      const prev = ex.time.get(key);
      if (!prev || date < prev.date)
        ex.time.set(key, { kind: 'time', sec: r.duration_sec, weight: r.weight, date, cheat });
    } else if (r.weight != null && r.reps != null) {
      const tn = wkTonnage.get(wk.id) ?? { date, tonnage: 0 };
      tn.tonnage += r.weight * r.reps;
      wkTonnage.set(wk.id, tn);
      const key = `${r.weight}x${r.reps}`;
      const prev = ex.reps.get(key);
      if (!prev || date < prev.date)
        ex.reps.set(key, {
          kind: 'reps',
          weight: r.weight,
          reps: r.reps,
          oneRm: oneRmEst(r.weight, r.reps),
          date,
          cheat,
        });
    }
  }

  const tonnageSeries = [...wkTonnage.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const totalTonnage = tonnageSeries.reduce((n, p) => n + p.tonnage, 0);
  const totalMin = [...wkDur.values()].reduce((n, m) => n + m, 0);

  const exList: ExRecords[] = [];
  for (const [id, ex] of exMap) {
    if (ex.time.size > 0) {
      const top = [...ex.time.values()].sort((a, b) => b.sec - a.sec).slice(0, 5);
      exList.push({ id, name: ex.name, cluster: ex.cluster, kind: 'time', top, headline: top[0].sec });
    } else if (ex.reps.size > 0) {
      const top = [...ex.reps.values()].sort((a, b) => b.oneRm - a.oneRm).slice(0, 5);
      exList.push({ id, name: ex.name, cluster: ex.cluster, kind: 'reps', top, headline: top[0].oneRm });
    }
  }

  const order: (Cluster | null)[] = [...CLUSTER_ORDER, null];
  const recordGroups: RecordGroup[] = order
    .map((c) => ({
      cluster: c,
      exercises: exList
        .filter((e) => e.cluster === c)
        .sort((a, b) => (a.kind === b.kind ? b.headline - a.headline : a.kind === 'reps' ? -1 : 1)),
    }))
    .filter((g) => g.exercises.length > 0);

  return { tonnageSeries, recordGroups, totalTonnage, totalSets, totalMin, workouts: wkSet.size };
}

function fmtDuration(min: number, t: (k: string) => string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}${t('analytics.hrShort')} ${m}${t('summary.min')}` : `${m} ${t('summary.min')}`;
}
function fmtTonnage(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}
function fmtSec(sec: number, secShort: string): string {
  if (sec < 60) return `${sec}${secShort}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
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
  rows: LoggedSet[],
  snaps: HealthSnapshot[],
  starts: string[],
  rangeDays: number,
): Correlation {
  const fromYmd = ymdDaysAgo(rangeDays - 1);
  const wk = new Map<string, { date: string; tonnage: number; rpeSum: number; rpeN: number }>();
  for (const r of rows) {
    const w = r.workout_exercises?.workouts;
    if (!w) continue;
    const date = ymdLocal(w.started_at);
    if (date < fromYmd) continue;
    let e = wk.get(w.id);
    if (!e) {
      e = { date, tonnage: 0, rpeSum: 0, rpeN: 0 };
      wk.set(w.id, e);
    }
    if (r.weight != null && r.reps != null && r.duration_sec == null) e.tonnage += r.weight * r.reps;
    if (r.rpe != null) {
      e.rpeSum += r.rpe;
      e.rpeN += 1;
    }
  }

  const snap = new Map<string, HealthSnapshot>();
  for (const s of snaps) snap.set(s.date, s);

  const workouts: CorrWorkout[] = [...wk.entries()]
    .map(([id, e]) => {
      const s = snap.get(e.date);
      return {
        id,
        date: e.date,
        tonnage: e.tonnage,
        avgRpe: e.rpeN ? e.rpeSum / e.rpeN : null,
        readiness: s?.readiness ?? null,
        sleep: s?.sleep_score ?? null,
        phase: phaseForDate(e.date, starts),
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

function CorrRow({ w, unitLabel }: { w: CorrWorkout; unitLabel: string }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (w.readiness != null) parts.push(`${t('analytics.readyShort')} ${Math.round(w.readiness)}`);
  if (w.sleep != null) parts.push(`${t('analytics.sleepShort')} ${Math.round(w.sleep)}`);
  if (w.avgRpe != null) parts.push(`RPE ${w.avgRpe.toFixed(1)}`);
  if (w.tonnage > 0) parts.push(`${fmtTonnage(w.tonnage)} ${unitLabel}`);
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
              {d.getDate()}.{d.getMonth() + 1}
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
const pad2 = (n: number) => String(n).padStart(2, '0');

function Calendar({
  monthOffset,
  info,
  starts,
  onPrev,
  onNext,
  onSelectDay,
}: {
  monthOffset: number;
  info: Map<string, DayInfo>;
  starts: Set<string>;
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
  const title = base.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
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
          const tint = di?.phase ? PHASE_TINT[di.phase] : 'bg-graphite-800';
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
        {PHASE_ORDER.map((p) => (
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
  const [openClusters, setOpenClusters] = useState<Record<string, boolean>>({});
  const [openEx, setOpenEx] = useState<Record<string, boolean>>({});
  const [range, setRange] = useState<number>(30);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['analytics-sets', userId],
    queryFn: () => getLoggedSets(),
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

  const a = useMemo(() => analyze(rows ?? [], lang), [rows, lang]);
  const recovery = useMemo(() => analyzeRecovery(snaps ?? [], range), [snaps, range]);
  const corr = useMemo(
    () => analyzeCorrelation(rows ?? [], snaps ?? [], cycleStarts ?? [], range),
    [rows, snaps, cycleStarts, range],
  );

  const dayInfo = useMemo(() => {
    const starts = cycleStarts ?? [];
    const m = new Map<string, DayInfo>();
    for (const s of snaps ?? [])
      m.set(s.date, {
        workout: false,
        tonnage: 0,
        readiness: s.readiness,
        sleep: s.sleep_score,
        phase: phaseForDate(s.date, starts),
      });
    for (const r of rows ?? []) {
      const w = r.workout_exercises?.workouts;
      if (!w) continue;
      const d = ymdLocal(w.started_at);
      const e =
        m.get(d) ??
        ({ workout: false, tonnage: 0, readiness: null, sleep: null, phase: phaseForDate(d, starts) } as DayInfo);
      e.workout = true;
      if (r.weight != null && r.reps != null && r.duration_sec == null) e.tonnage += r.weight * r.reps;
      m.set(d, e);
    }
    return m;
  }, [snaps, rows, cycleStarts]);
  const startsSet = useMemo(() => new Set(cycleStarts ?? []), [cycleStarts]);
  const unitLabel = t(`common.${unit}`);
  const secShort = t('workout.secShort');

  const recLine = (r: RepRec | TimeRec, i: number) => {
    const left =
      r.kind === 'reps'
        ? `${i + 1}.  ${r.weight} ${unitLabel} × ${r.reps}`
        : `${i + 1}.  ${fmtSec(r.sec, secShort)}${r.weight != null ? ` · ${r.weight} ${unitLabel}` : ''}`;
    const right =
      r.kind === 'reps' ? `≈${Math.round(r.oneRm)} · ${fmtDate(r.date)}` : fmtDate(r.date);
    return (
      <View key={i} className="flex-row items-center justify-between py-1">
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

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <Text className="text-2xl font-extrabold text-graphite-50">{t('analytics.title')}</Text>

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
                <Stat label={`${t('summary.tonnage')}, ${unitLabel}`} value={fmtTonnage(a.totalTonnage)} />
              </View>
              <View className="flex-row gap-3">
                <Stat label={t('summary.sets')} value={String(a.totalSets)} />
                <Stat label={t('analytics.statTime')} value={fmtDuration(a.totalMin, t)} />
              </View>
            </View>

            <Text className="mb-2 mt-7 text-sm font-semibold uppercase tracking-wide text-graphite-500">
              {t('analytics.tonnageTrend')}
            </Text>
            <TonnageBars series={a.tonnageSeries} unit={unitLabel} hint={t('analytics.tonnageHint')} />

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
                            ex.kind === 'reps'
                              ? `≈${Math.round(ex.headline)} ${unitLabel}`
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
                                  {ex.top.map((r, i) => recLine(r, i))}
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
                    <CorrRow key={w.id} w={w} unitLabel={unitLabel} />
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
                      {di?.phase ? (
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
                            value={di.tonnage > 0 ? `${fmtTonnage(di.tonnage)} ${unitLabel}` : '✓'}
                          />
                        ) : null}
                        {!di ? (
                          <Text className="text-sm text-graphite-500">{t('analytics.noDataDay')}</Text>
                        ) : null}
                      </View>
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
