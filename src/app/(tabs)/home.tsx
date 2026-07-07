import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsButton } from '@/components/settings-button';
import { SyncStatus } from '@/components/sync-status';
import { useAuth } from '@/lib/auth/auth-context';
import {
  type AnalyticsSummary,
  getAnalyticsSummary,
  topPerKey,
} from '@/lib/db/analytics';
import { getCycleStatus, getTrackCycle } from '@/lib/db/cycle';
import { getLatestSnapshot, getOuraConnected } from '@/lib/db/oura';
import { listWorkoutSummaries } from '@/lib/db/workouts';
import { humanDate, localYmd } from '@/lib/dates';
import i18n from '@/lib/i18n';
import { pluralCount } from '@/lib/plural';
import { useTabBarHeight } from '@/lib/tab-bar';
import { useRole } from '@/lib/use-role';
import { useStartEmptyWorkout } from '@/lib/use-start-workout';
import { fromKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';

// почти статичные данные (флаги/сводки) не перезапрашиваем на каждый холодный старт:
// Головна — лендинг, и с дефолтным staleTime 30с она стреляла бы всеми запросами при
// каждом открытии апки. Инвалидации по префиксу ['analytics'] всё равно освежают сводку.
const CALM_STALE_MS = 1000 * 60 * 30;

type RecordHighlight = { name: string; detail: string; date: string };

// самый свежий топ-1 рекорд по всем категориям (вес×повторы / удержание / эспандер)
function latestRecord(
  sum: AnalyticsSummary,
  lang: string,
  unit: WeightUnit,
  unitLabel: string,
): RecordHighlight | null {
  const exName = (r: { name_en: string | null; name_uk: string | null; display_name: string | null }) =>
    (lang === 'uk' ? r.name_uk : r.name_en) ?? r.display_name ?? '—';
  const all: RecordHighlight[] = [
    ...topPerKey(sum.rep_records, (r) => r.exercise_id).map((r) => ({
      name: exName(r),
      detail: `${fromKg(r.weight, unit)} ${unitLabel} × ${r.reps}`,
      date: r.date,
    })),
    ...topPerKey(sum.time_records, (r) => r.exercise_id).map((r) => ({
      name: exName(r),
      detail: r.weight != null ? `${fromKg(r.weight, unit)} ${unitLabel} · ${r.sec}s` : `${r.sec}s`,
      date: r.date,
    })),
    ...topPerKey(sum.grip_records, (r) => r.set_type).map((r) => ({
      name: r.gripper_name ?? r.set_type,
      detail: `× ${r.reps}`,
      date: r.date,
    })),
  ];
  if (!all.length) return null;
  return all.reduce((best, r) => (r.date > best.date ? r : best));
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const grip = useRole() === 'grip';
  const lang = i18n.language;
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const unit = useWeightUnit();
  const unitLabel = t(`common.${unit}`);
  const tabBarHeight = useTabBarHeight();

  // все ключи — общие с экранами Тренування/Здоров'я/Аналітика: кэш один, хаб не плодит запросов
  const { data: workouts } = useQuery({
    queryKey: ['workouts', userId],
    queryFn: () => listWorkoutSummaries(userId as string),
    enabled: !!userId,
  });
  const { data: connected } = useQuery({
    queryKey: ['oura-connected', userId],
    queryFn: () => getOuraConnected(userId as string),
    enabled: !!userId,
    staleTime: CALM_STALE_MS,
  });
  const { data: snapshot } = useQuery({
    queryKey: ['oura-snapshot', userId],
    queryFn: () => getLatestSnapshot(userId as string),
    enabled: !!userId && !!connected,
    staleTime: CALM_STALE_MS,
  });
  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
    staleTime: CALM_STALE_MS,
  });
  const { data: cycle } = useQuery({
    queryKey: ['cycle', userId],
    queryFn: () => getCycleStatus(userId as string),
    enabled: !!userId && !!trackCycle,
    staleTime: CALM_STALE_MS,
  });
  // тяжёлый RPC (агрегация всей истории) — на лендинге живём кэшем, свежесть
  // обеспечивают инвалидации ['analytics'] после финиша/удаления/импорта тренировки
  const { data: summary } = useQuery({
    queryKey: ['analytics', 'summary', userId],
    queryFn: getAnalyticsSummary,
    enabled: !!userId,
    staleTime: CALM_STALE_MS,
  });

  const list = workouts ?? [];
  const active = list.find((w) => !w.ended_at);
  const recent = list.filter((w) => w.ended_at).slice(0, 3);
  const record = summary ? latestRecord(summary, lang, unit, unitLabel) : null;

  const onStart = useStartEmptyWorkout();

  // карточка видна только когда есть хоть один заполненный чип: снимок OURA может прийти
  // с null-скорами (дневные скоры отстают от синка) — пустую серую карточку не показываем
  const hasReadiness = snapshot?.readiness != null;
  const hasSleep = snapshot?.sleep_score != null;
  const hasCycle = !!trackCycle && !!cycle;
  const showSnapshot = hasReadiness || hasSleep || hasCycle;
  const staleLabel =
    snapshot && snapshot.date !== localYmd() ? t('hub.asOf', { date: snapshot.date.slice(5) }) : null;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: tabBarHeight + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-extrabold text-graphite-50">{t('hub.title')}</Text>
            <Text className="mt-0.5 text-xs capitalize text-graphite-500">
              {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <SettingsButton />
        </View>

        <SyncStatus />

        {/* снимок дня: OURA-готовность/сон + день цикла; виден только тем, у кого есть данные */}
        {showSnapshot && (
          <Pressable
            onPress={() => router.push('/health')}
            className="mt-4 rounded-2xl bg-graphite-900 px-5 py-4 active:opacity-80"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wide text-graphite-500">
                {t('hub.snapshot')}
              </Text>
              {staleLabel && <Text className="text-[11px] text-amber-500/80">{staleLabel}</Text>}
            </View>
            <View className="mt-2 flex-row flex-wrap gap-x-6 gap-y-1">
              {hasReadiness && (
                <View>
                  <Text className="text-xl font-extrabold text-graphite-50">{snapshot!.readiness}</Text>
                  <Text className="text-xs text-graphite-500">{t('hub.readiness')}</Text>
                </View>
              )}
              {hasSleep && (
                <View>
                  <Text className="text-xl font-extrabold text-graphite-50">{snapshot!.sleep_score}</Text>
                  <Text className="text-xs text-graphite-500">{t('hub.sleep')}</Text>
                </View>
              )}
              {hasCycle && (
                <View>
                  <Text className="text-xl font-extrabold text-graphite-50">{cycle!.day}</Text>
                  <Text className="text-xs text-graphite-500">
                    {t('hub.cycleDay')} · {t(`health.cycle.phase.${cycle!.phase}`)}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        )}

        {active && (
          <Pressable
            onPress={() => router.push({ pathname: '/workout/[id]', params: { id: active.id } })}
            className="mt-4 flex-row items-center justify-between rounded-2xl border border-accent bg-graphite-900 px-5 py-4 active:opacity-80"
          >
            <View>
              <Text className="text-base font-bold text-accent">{t('home.resume')}</Text>
              <Text className="mt-0.5 text-xs text-graphite-400">
                {humanDate(active.started_at, locale)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#1FB89A" />
          </Pressable>
        )}

        <Pressable
          onPress={onStart}
          className="mt-4 items-center rounded-2xl bg-accent py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('home.start')}</Text>
        </Pressable>

        {!grip && (
          <Pressable
            onPress={() => router.push('/programs')}
            className="mt-3 items-center rounded-2xl border border-graphite-700 py-3.5 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-graphite-200">{t('hub.fromProgram')}</Text>
          </Pressable>
        )}

        {/* последний топ-1 рекорд по всей истории — «залипательный» хайлайт, тап → Аналітика */}
        {record && (
          <Pressable
            onPress={() => router.push('/analytics')}
            className="mt-4 flex-row items-center gap-3 rounded-2xl bg-graphite-900 px-5 py-4 active:opacity-80"
          >
            <Text className="text-xl">🏆</Text>
            <View className="flex-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-graphite-500">
                {t('hub.lastRecord')}
              </Text>
              <Text className="mt-0.5 text-base font-semibold text-graphite-100" numberOfLines={1}>
                {record.name} · {record.detail}
              </Text>
            </View>
            <Text className="text-xs text-graphite-500">{humanDate(record.date, locale)}</Text>
          </Pressable>
        )}

        {recent.length > 0 && (
          <>
            <View className="mb-3 mt-8 flex-row items-center justify-between">
              <Text className="text-sm font-semibold uppercase tracking-wide text-graphite-500">
                {t('home.recent')}
              </Text>
              <Pressable onPress={() => router.push('/workouts')} hitSlop={8} className="active:opacity-70">
                <Text className="text-sm font-semibold text-accent">{t('hub.allHistory')}</Text>
              </Pressable>
            </View>
            <View className="gap-3">
              {recent.map((w) => {
                const counts = [
                  pluralCount(t, lang, 'exercises', w.exercise_count ?? 0),
                  pluralCount(t, lang, 'sets', w.set_count ?? 0),
                ].join(' · ');
                return (
                  <Pressable
                    key={w.id}
                    onPress={() => router.push({ pathname: '/summary/[id]', params: { id: w.id } })}
                    className="flex-row items-center justify-between rounded-2xl bg-graphite-900 px-4 py-3.5 active:opacity-80"
                  >
                    <View>
                      <Text className="text-base font-semibold capitalize text-graphite-100">
                        {humanDate(w.started_at, locale)}
                      </Text>
                      <Text className="mt-0.5 text-sm text-graphite-400">
                        {counts}
                        {(w.tonnage ?? 0) > 0
                          ? ` · ${Math.round(fromKg(w.tonnage, unit) ?? 0)} ${unitLabel}`
                          : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#3A3F49" />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
