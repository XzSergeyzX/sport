import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
} from '@/lib/db/oura';

const PLACEHOLDER = '#848D9A';

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

type Metric = { key: string; value: string; unit?: string };

// Собираем все доступные показатели из снимка (+ raw). Показываем только заполненные.
function buildMetrics(s: HealthSnapshot | null | undefined): Metric[] {
  if (!s) return [];
  const sd = s.raw?.sleepDetail ?? {};
  const out: Metric[] = [];
  const push = (key: string, value: number | null | undefined, unit?: string, fmt?: (v: number) => string) => {
    if (value == null) return;
    out.push({ key, value: fmt ? fmt(value) : String(value), unit });
  };

  push('readiness', s.readiness);
  push('sleep', s.sleep_score);
  push('hrv', s.hrv, 'ms', (v) => String(Math.round(v)));
  push('rhr', s.rhr, 'bpm', (v) => String(Math.round(v)));
  push('temp', s.temp, 'c', (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`);
  push('respiratory', sd.average_breath, 'brmin', (v) => v.toFixed(1));
  push('duration', sd.total_sleep_duration, 'h', (v) => fmtDur(v));
  push('efficiency', sd.efficiency, 'pct', (v) => String(Math.round(v)));
  return out;
}

function MetricCard({ m, onPress }: { m: Metric; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      className="mb-3 w-[48%] rounded-2xl bg-graphite-800 p-4 active:opacity-80"
    >
      <View className="flex-row items-baseline">
        <Text className="text-2xl font-extrabold text-graphite-50">{m.value}</Text>
        {m.unit ? <Text className="ml-1 text-xs text-graphite-500">{t(`health.units.${m.unit}`)}</Text> : null}
      </View>
      <Text className="mt-1 text-xs text-graphite-400">{t(`health.metrics.${m.key}`)}</Text>
      <Text className="mt-2 text-[10px] uppercase tracking-wide text-graphite-600">{t('health.tapInfo')}</Text>
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

  const syncMut = useMutation({
    mutationFn: () => syncOura(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oura-snapshot', userId] }),
  });

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
