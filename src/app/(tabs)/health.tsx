import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { getCycleStatus, getTrackCycle, logPeriodStart } from '@/lib/db/cycle';
import i18n from '@/lib/i18n';
import {
  connectOura,
  getLatestSnapshot,
  getOuraConnected,
  type HealthSnapshot,
  syncOura,
  type SyncResult,
} from '@/lib/db/oura';

const PLACEHOLDER = '#848D9A';

// минуты → ч:мм
function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return `${h}:${String(mm).padStart(2, '0')}`;
}

// сегодняшняя дата в локальном времени (YYYY-MM-DD) — для сверки с днём снимка OURA
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Metric = { key: string; value: string; unit?: string };

// Все показатели снимка из первоклассных колонок. Показываем только заполненные.
function buildMetrics(s: HealthSnapshot | null | undefined): Metric[] {
  if (!s) return [];
  const out: Metric[] = [];
  const push = (key: string, value: number | null | undefined, unit?: string, fmt?: (v: number) => string) => {
    if (value == null) return;
    out.push({ key, value: fmt ? fmt(value) : String(value), unit });
  };
  const round = (v: number) => String(Math.round(v));

  // recovery
  push('readiness', s.readiness);
  push('hrv', s.hrv, 'ms', round);
  push('rhr', s.rhr, 'bpm', round);
  push('avg_hr', s.avg_hr, 'bpm', round);
  push('temp', s.temp, 'c', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
  // sleep
  push('sleep', s.sleep_score);
  push('duration', s.sleep_total_min, 'h', fmtMin);
  push('deep', s.sleep_deep_min, 'h', fmtMin);
  push('rem', s.sleep_rem_min, 'h', fmtMin);
  push('light', s.sleep_light_min, 'h', fmtMin);
  push('in_bed', s.time_in_bed_min, 'h', fmtMin);
  push('efficiency', s.sleep_efficiency, 'pct', round);
  push('latency', s.sleep_latency_min, 'min', round);
  push('respiratory', s.respiratory_rate, 'brmin', (v) => v.toFixed(1));
  // activity
  push('activity', s.activity_score);
  push('steps', s.steps, undefined, round);
  push('active_cal', s.active_calories, 'kcal', round);
  push('total_cal', s.total_calories, 'kcal', round);
  // spo2 / stress / долгосрочные
  push('spo2', s.spo2_avg, 'pct', (v) => v.toFixed(1));
  push('stress', s.stress_high_min, 'min', round);
  push('vo2', s.vo2_max, undefined, (v) => v.toFixed(1));
  push('vascular_age', s.vascular_age, 'yr', round);
  if (s.resilience_level) out.push({ key: 'resilience', value: s.resilience_level });
  return out;
}

function MetricCard({ m, onPress }: { m: Metric; onPress: () => void }) {
  const { t } = useTranslation();
  const hasRef = i18n.exists(`health.ref.${m.key}.what`);
  return (
    <Pressable
      onPress={hasRef ? onPress : undefined}
      className="mb-3 w-[48%] rounded-2xl bg-graphite-800 p-4 active:opacity-80"
    >
      <View className="flex-row items-baseline">
        <Text className="text-2xl font-extrabold text-graphite-50">{m.value}</Text>
        {m.unit ? <Text className="ml-1 text-xs text-graphite-500">{t(`health.units.${m.unit}`)}</Text> : null}
      </View>
      <Text className="mt-1 text-xs text-graphite-400">{t(`health.metrics.${m.key}`)}</Text>
      {hasRef ? (
        <Text className="mt-2 text-[10px] uppercase tracking-wide text-graphite-600">{t('health.tapInfo')}</Text>
      ) : null}
    </Pressable>
  );
}

function MetricSheet({ metricKey, onClose }: { metricKey: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal visible={!!metricKey} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onPress={onClose}>
        <Pressable onPress={() => {}} className="rounded-t-3xl bg-graphite-900 px-6 pb-10 pt-5">
          {metricKey && (
            <>
              <Text className="text-xl font-extrabold text-graphite-50">
                {t(`health.metrics.${metricKey}`)}
              </Text>
              <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
                {t('health.whatTitle')}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-graphite-300">
                {t(`health.ref.${metricKey}.what`)}
              </Text>
              <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
                {t('health.rangeTitle')}
              </Text>
              <Text className="mt-1 text-sm leading-5 text-graphite-300">
                {t(`health.ref.${metricKey}.range`)}
              </Text>
              <Pressable
                onPress={onClose}
                className="mt-6 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                <Text className="text-sm font-semibold text-graphite-200">{t('summary.done')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function HealthScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: connected } = useQuery({
    queryKey: ['oura-connected', userId],
    queryFn: () => getOuraConnected(userId as string),
    enabled: !!userId,
  });

  const { data: snapshot } = useQuery({
    queryKey: ['oura-snapshot', userId],
    queryFn: () => getLatestSnapshot(userId as string),
    enabled: !!userId && !!connected,
  });

  const [syncInfo, setSyncInfo] = useState<SyncResult | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  const syncMut = useMutation({
    mutationFn: () => syncOura(),
    onSuccess: (res) => {
      setSyncInfo(res);
      setSyncErr(null);
      qc.invalidateQueries({ queryKey: ['oura-snapshot', userId] });
    },
    onError: (e: Error) => setSyncErr(e.message || 'sync_failed'),
  });

  // авто-обновление при каждом заходе на вкладку (как только OURA API догонит — подтянется)
  useFocusEffect(
    useCallback(() => {
      if (connected) syncMut.mutate();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected]),
  );

  const connectMut = useMutation({
    mutationFn: () => connectOura(token.trim()),
    onSuccess: () => {
      setToken('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['oura-connected', userId] });
      syncMut.mutate();
    },
    onError: () => setError(t('health.connectError')),
  });

  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
  });

  const { data: cycle } = useQuery({
    queryKey: ['cycle', userId],
    queryFn: () => getCycleStatus(userId as string),
    enabled: !!userId && !!trackCycle,
  });

  const logCycleMut = useMutation({
    mutationFn: () => logPeriodStart(userId as string),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycle', userId] }),
  });

  const metrics = buildMetrics(snapshot);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <Text className="text-2xl font-extrabold text-graphite-50">{t('health.title')}</Text>

        <View className="mt-6 rounded-2xl bg-graphite-900 p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-graphite-100">{t('health.ouraTitle')}</Text>
            <Text className="text-xs uppercase tracking-wide text-graphite-500">
              {connected ? t('health.connected') : t('health.optional')}
            </Text>
          </View>

          {!connected ? (
            <>
              <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.ouraBody')}</Text>
              <Text className="mt-3 text-xs text-graphite-600">{t('health.tokenHint')}</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder={t('health.tokenPlaceholder')}
                placeholderTextColor={PLACEHOLDER}
                autoCapitalize="none"
                autoCorrect={false}
                className="mt-2 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
              />
              {error && <Text className="mt-2 text-sm text-red-400">{error}</Text>}
              <Pressable
                disabled={connectMut.isPending || token.trim().length === 0}
                onPress={() => connectMut.mutate()}
                className="mt-3 items-center rounded-xl bg-accent py-3 active:opacity-80"
                style={{ opacity: token.trim().length === 0 ? 0.5 : 1 }}
              >
                {connectMut.isPending ? (
                  <ActivityIndicator color="#0C0E12" />
                ) : (
                  <Text className="text-sm font-bold text-graphite-950">{t('health.connectOura')}</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              {snapshot?.date && (
                <Text className="mt-3 text-xs text-graphite-500">
                  {t('health.asOf', {
                    date: new Date(snapshot.date).toLocaleDateString(
                      i18n.language === 'uk' ? 'uk-UA' : 'en-US',
                      { day: 'numeric', month: 'long' },
                    ),
                  })}
                </Text>
              )}
              {snapshot?.date && snapshot.date < todayYmd() && (
                <Text className="mt-1 text-xs leading-4 text-amber-500/80">{t('health.stale')}</Text>
              )}
              {metrics.length > 0 ? (
                <View className="mt-3 flex-row flex-wrap justify-between">
                  {metrics.map((m) => (
                    <MetricCard key={m.key} m={m} onPress={() => setSelected(m.key)} />
                  ))}
                </View>
              ) : (
                <Text className="mt-3 text-sm text-graphite-400">{t('health.noData')}</Text>
              )}
              <Pressable
                disabled={syncMut.isPending}
                onPress={() => syncMut.mutate()}
                className="mt-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                {syncMut.isPending ? (
                  <ActivityIndicator color="#848D9A" />
                ) : (
                  <Text className="text-sm font-semibold text-graphite-200">{t('health.syncNow')}</Text>
                )}
              </Pressable>

              {(syncErr || syncInfo) && (
                <Pressable onPress={() => setShowDiag((v) => !v)} className="mt-2 active:opacity-70">
                  <Text className="text-center text-[10px] uppercase tracking-wide text-graphite-600">
                    {t('health.diag')}
                  </Text>
                </Pressable>
              )}
              {showDiag && (
                <View className="mt-2 rounded-xl bg-graphite-800 p-3">
                  {syncErr ? <Text className="text-xs text-red-400">{syncErr}</Text> : null}
                  {syncInfo?.days != null ? (
                    <Text className="text-[11px] text-graphite-300">
                      {t('health.diagDays', { n: syncInfo.days })} · {syncInfo.from} → {syncInfo.to}
                    </Text>
                  ) : null}
                  {syncInfo?.diag
                    ? Object.entries(syncInfo.diag).map(([k, v]) => (
                        <Text key={k} className="mt-0.5 text-[11px] text-graphite-400">
                          {k}: HTTP {v.status} · {v.count}d · {v.latest ?? '—'}
                        </Text>
                      ))
                    : null}
                </View>
              )}
            </>
          )}
        </View>

        {trackCycle && (
          <View className="mt-4 rounded-2xl bg-graphite-900 p-5">
            <Text className="text-base font-semibold text-graphite-100">{t('health.cycle.title')}</Text>
            {cycle ? (
              <>
                <Text className="mt-3 text-3xl font-extrabold text-graphite-50">
                  {t('health.cycle.day', { day: cycle.day })}
                </Text>
                <Text className="mt-1 text-sm text-accent">
                  {t(`health.cycle.phase.${cycle.phase}`)}
                </Text>
                <Text className="mt-1 text-xs text-graphite-600">
                  {t('health.cycle.since', { date: cycle.startDate })}
                </Text>
              </>
            ) : (
              <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.cycle.empty')}</Text>
            )}
            {/* «Новий цикл» нужен только когда подходит срок (поздняя фаза) или цикл ещё не начат —
                иначе кнопка только мешает: день/фаза считаются автоматически. */}
            {(!cycle || cycle.day >= 20) && (
              <Pressable
                disabled={logCycleMut.isPending}
                onPress={() => logCycleMut.mutate()}
                className="mt-3 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                {logCycleMut.isPending ? (
                  <ActivityIndicator color="#848D9A" />
                ) : (
                  <Text className="text-sm font-semibold text-graphite-200">
                    {cycle ? t('health.cycle.newCycle') : t('health.cycle.markDay1')}
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        )}

        <View className="mt-4 rounded-2xl bg-graphite-900 p-5">
          <Text className="text-base font-semibold text-graphite-100">{t('health.soonTitle')}</Text>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.soonBody')}</Text>
        </View>
      </ScrollView>

      <MetricSheet metricKey={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}
