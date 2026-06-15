import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { connectOura, getLatestSnapshot, getOuraConnected, syncOura } from '@/lib/db/oura';

const PLACEHOLDER = '#848D9A';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-graphite-800 p-4">
      <Text className="text-2xl font-extrabold text-graphite-50">{value}</Text>
      <Text className="mt-1 text-xs uppercase tracking-wide text-graphite-500">{label}</Text>
    </View>
  );
}

export default function HealthScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-1 px-6 pt-4">
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
              <View className="mt-4 flex-row gap-3">
                <Metric
                  label={t('health.readiness')}
                  value={snapshot?.readiness != null ? String(snapshot.readiness) : '–'}
                />
                <Metric
                  label={t('health.sleep')}
                  value={snapshot?.sleep_score != null ? String(snapshot.sleep_score) : '–'}
                />
              </View>
              {!snapshot && <Text className="mt-3 text-sm text-graphite-400">{t('health.noData')}</Text>}
              <Pressable
                disabled={syncMut.isPending}
                onPress={() => syncMut.mutate()}
                className="mt-4 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
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

        <View className="mt-4 rounded-2xl bg-graphite-900 p-5">
          <Text className="text-base font-semibold text-graphite-100">{t('health.soonTitle')}</Text>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('health.soonBody')}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
