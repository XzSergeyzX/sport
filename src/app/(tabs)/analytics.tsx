import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { exerciseName } from '@/lib/db/exercises';
import { listWorkouts, type WorkoutDetail } from '@/lib/db/workouts';
import i18n from '@/lib/i18n';
import { useWeightUnit } from '@/lib/use-unit';

// оценка 1ПМ по О'Коннору: вес × (1 + 0.025 × повторы) — честнее (ниже Эпли)
const oneRmEst = (weight: number, reps: number) => weight * (1 + 0.025 * reps);

type TonnagePoint = { date: string; tonnage: number };
type Pr = { id: string; name: string; oneRm: number; weight: number; reps: number };

function analyze(workouts: WorkoutDetail[], lang: string) {
  const tonnageSeries: TonnagePoint[] = [];
  const prs = new Map<string, Pr>();
  let totalTonnage = 0;
  let totalSets = 0;
  let totalMin = 0;

  // newest-first → разворачиваем в хронологию
  for (const w of [...workouts].reverse()) {
    if (w.ended_at) {
      totalMin += Math.max(0, Math.round((+new Date(w.ended_at) - +new Date(w.started_at)) / 60000));
    }
    let wt = 0;
    for (const we of w.workout_exercises ?? []) {
      const name = we.display_name ?? (we.exercise ? exerciseName(we.exercise, lang) : '—');
      for (const s of we.sets ?? []) {
        // считаем только отмеченные силовые подходы (вес×повторы), удержания пропускаем
        if (!s.logged_at || s.weight == null || s.reps == null || s.duration_sec != null) continue;
        wt += s.weight * s.reps;
        totalSets += 1;
        const oneRm = oneRmEst(s.weight, s.reps);
        const cur = prs.get(we.exercise_id);
        if (!cur || oneRm > cur.oneRm) {
          prs.set(we.exercise_id, { id: we.exercise_id, name, oneRm, weight: s.weight, reps: s.reps });
        }
      }
    }
    if (wt > 0) {
      tonnageSeries.push({ date: w.started_at, tonnage: wt });
      totalTonnage += wt;
    }
  }

  const records = [...prs.values()].sort((a, b) => b.oneRm - a.oneRm);
  return { tonnageSeries, records, totalTonnage, totalSets, totalMin, workouts: tonnageSeries.length };
}

function fmtDuration(min: number, t: (k: string) => string): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}${t('analytics.hrShort')} ${m}${t('summary.min')}` : `${m} ${t('summary.min')}`;
}

function fmtTonnage(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-graphite-900 p-4">
      <Text className="text-2xl font-extrabold text-graphite-50">{value}</Text>
      <Text className="mt-1 text-xs uppercase tracking-wide text-graphite-500">{label}</Text>
    </View>
  );
}

function TonnageBars({
  series,
  unit,
  hint,
}: {
  series: TonnagePoint[];
  unit: string;
  hint: string;
}) {
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

  const { data: workouts, isLoading } = useQuery({
    queryKey: ['workouts', userId],
    queryFn: () => listWorkouts(userId as string),
    enabled: !!userId,
  });

  const a = useMemo(() => analyze(workouts ?? [], lang), [workouts, lang]);
  const unitLabel = t(`common.${unit}`);

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
                <Stat
                  label={`${t('summary.tonnage')}, ${unitLabel}`}
                  value={fmtTonnage(a.totalTonnage)}
                />
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
              {a.records.slice(0, 15).map((r) => (
                <View
                  key={r.id}
                  className="flex-row items-center justify-between rounded-2xl bg-graphite-900 p-4"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-base font-semibold text-graphite-100" numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text className="mt-0.5 text-xs text-graphite-500">
                      {r.weight} {unitLabel} × {r.reps}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-lg font-extrabold text-accent">{Math.round(r.oneRm)}</Text>
                    <Text className="text-[10px] uppercase tracking-wide text-graphite-600">
                      {t('analytics.est1rm')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
