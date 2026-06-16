import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { type Cluster, CLUSTER_ORDER, clusterKey, exerciseName } from '@/lib/db/exercises';
import { listWorkouts, type WorkoutDetail } from '@/lib/db/workouts';
import i18n from '@/lib/i18n';
import { useWeightUnit } from '@/lib/use-unit';

// оценка 1ПМ по О'Коннору: вес × (1 + 0.025 × повторы) — честнее (ниже Эпли)
const oneRmEst = (weight: number, reps: number) => weight * (1 + 0.025 * reps);

type TonnagePoint = { date: string; tonnage: number };
type RepRec = { kind: 'reps'; weight: number; reps: number; oneRm: number; date: string };
type TimeRec = { kind: 'time'; sec: number; weight: number | null; date: string };
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

function analyze(workouts: WorkoutDetail[], lang: string) {
  const tonnageSeries: TonnagePoint[] = [];
  let totalTonnage = 0;
  let totalSets = 0;
  let totalMin = 0;
  const exMap = new Map<string, Acc>();

  for (const w of [...workouts].reverse()) {
    if (w.ended_at) {
      totalMin += Math.max(0, Math.round((+new Date(w.ended_at) - +new Date(w.started_at)) / 60000));
    }
    let wt = 0;
    for (const we of w.workout_exercises ?? []) {
      const name = we.display_name ?? (we.exercise ? exerciseName(we.exercise, lang) : '—');
      const cluster = we.exercise?.cluster ?? null;
      let ex = exMap.get(we.exercise_id);
      if (!ex) {
        ex = { name, cluster, reps: new Map(), time: new Map() };
        exMap.set(we.exercise_id, ex);
      } else {
        ex.name = name;
        if (cluster) ex.cluster = cluster;
      }
      for (const s of we.sets ?? []) {
        if (!s.logged_at) continue;
        const date = w.started_at;
        if (s.duration_sec != null) {
          totalSets += 1;
          const key = `${s.duration_sec}@${s.weight ?? ''}`;
          const prev = ex.time.get(key);
          if (!prev || date < prev.date)
            ex.time.set(key, { kind: 'time', sec: s.duration_sec, weight: s.weight, date });
        } else if (s.weight != null && s.reps != null) {
          totalSets += 1;
          wt += s.weight * s.reps;
          const key = `${s.weight}x${s.reps}`;
          const prev = ex.reps.get(key);
          if (!prev || date < prev.date)
            ex.reps.set(key, {
              kind: 'reps',
              weight: s.weight,
              reps: s.reps,
              oneRm: oneRmEst(s.weight, s.reps),
              date,
            });
        }
      }
    }
    if (wt > 0) {
      tonnageSeries.push({ date: w.started_at, tonnage: wt });
      totalTonnage += wt;
    }
  }

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

  return { tonnageSeries, recordGroups, totalTonnage, totalSets, totalMin, workouts: tonnageSeries.length };
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

export default function AnalyticsScreen() {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const lang = i18n.language;
  const { session } = useAuth();
  const userId = session?.user.id;
  const [openClusters, setOpenClusters] = useState<Record<string, boolean>>({});
  const [openEx, setOpenEx] = useState<Record<string, boolean>>({});

  const { data: workouts, isLoading } = useQuery({
    queryKey: ['workouts', userId],
    queryFn: () => listWorkouts(userId as string),
    enabled: !!userId,
  });

  const a = useMemo(() => analyze(workouts ?? [], lang), [workouts, lang]);
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
        <Text className="flex-1 text-sm text-graphite-200">{left}</Text>
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
        ) : a.workouts === 0 ? (
          <View className="mt-6 rounded-2xl bg-graphite-900 p-5">
            <Text className="text-sm leading-5 text-graphite-400">{t('analytics.empty')}</Text>
          </View>
        ) : (
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
      </ScrollView>
    </SafeAreaView>
  );
}
