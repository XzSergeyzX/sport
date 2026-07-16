import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { useConfirmedVideoLink } from '@/components/video-link';
import { useAuth } from '@/lib/auth/auth-context';
import {
  type LeaderboardRow,
  listPendingEntries,
  reviewEntry,
  rowRgcKg,
} from '@/lib/db/leaderboard';
import { fromKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';
import { useRole } from '@/lib/use-role';

// Админ-панель лидерборда: очередь pending-заявок отдельно от публичного борда
// (фидбек Сергея: «слишком всё в одном месте»). Гейт роли — в RPC, тут только UX.

function result(r: LeaderboardRow, unit: WeightUnit, t: (k: string) => string): string {
  if (r.weight_kg != null) {
    const v = Math.round((fromKg(r.weight_kg, unit) as number) * 10) / 10;
    return `${r.dynamometer ?? '—'} · ${Number.isInteger(v) ? v : v.toFixed(1)} ${t(`common.${unit}`)}`;
  }
  const name = r.gripper_brand ? `${r.gripper_brand} ${r.gripper_name}` : (r.gripper_name ?? '—');
  const kg = rowRgcKg(r);
  const st = r.set_type ? ` · ${t(`setTypes.${r.set_type}`)}` : '';
  return `${name}${kg != null ? ` · ${Math.round(kg)} kg` : ''}${st}`;
}

function PendingCard({
  row,
  onOpenVideo,
  onDone,
}: {
  row: LeaderboardRow;
  onOpenVideo: (url: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const reviewMut = useMutation({
    mutationFn: (action: 'approved' | 'rejected') => reviewEntry(row.entry_id, action),
    onSuccess: onDone,
  });
  return (
    <View className="mb-3 rounded-2xl bg-graphite-900 p-4">
      <View className="flex-row items-center">
        <Avatar email={row.display_name} avatarKey={row.avatar} size={32} />
        <Text className="ml-2 flex-1 text-base font-semibold text-graphite-100" numberOfLines={1}>
          {row.display_name}
        </Text>
        {row.certified && (
          <View className="mr-2 flex-row items-center rounded-full bg-graphite-800 px-2 py-1">
            <Ionicons name="ribbon-outline" size={13} color="#1FB89A" />
            <Text className="ml-1 text-xs text-graphite-300">{t('leaderboard.certifiedShort')}</Text>
          </View>
        )}
      </View>
      <Text className="mt-2 text-base text-graphite-200">{result(row, unit, t)}</Text>
      {!!row.note && <Text className="mt-1 text-sm text-graphite-500">{row.note}</Text>}
      <Pressable
        onPress={() => onOpenVideo(row.video_url)}
        className="mt-3 flex-row items-center justify-center rounded-xl bg-graphite-800 py-2.5 active:opacity-80"
      >
        <Ionicons name="play-circle-outline" size={20} color="#1FB89A" />
        <Text className="ml-2 text-sm font-semibold text-graphite-100">{t('leaderboard.watchProof')}</Text>
      </Pressable>
      <View className="mt-2 flex-row gap-2">
        <Pressable
          disabled={reviewMut.isPending}
          onPress={() => reviewMut.mutate('approved')}
          className="flex-1 items-center rounded-xl bg-accent py-3 active:opacity-80"
        >
          <Text className="text-sm font-bold text-graphite-950">{t('leaderboard.approve')}</Text>
        </Pressable>
        <Pressable
          disabled={reviewMut.isPending}
          onPress={() => reviewMut.mutate('rejected')}
          className="flex-1 items-center rounded-xl bg-graphite-800 py-3 active:opacity-80"
        >
          <Text className="text-sm font-semibold text-red-400">{t('leaderboard.reject')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ModerationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, initializing } = useAuth();
  const role = useRole();
  const { openVideo, videoDialog } = useConfirmedVideoLink();

  const { data: pending, isLoading } = useQuery({
    queryKey: ['leaderboard-pending'],
    queryFn: listPendingEntries,
    enabled: role === 'admin',
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leaderboard-pending'] });
    qc.invalidateQueries({ queryKey: ['leaderboard', 'dynamometer'] });
    qc.invalidateQueries({ queryKey: ['leaderboard', 'gripper'] });
  };

  if (!initializing && !session) return <Redirect href="/auth" />;
  if (session && role === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-graphite-950">
        <ActivityIndicator color="#848D9A" />
      </View>
    );
  }
  // не-админа сюда не ведёт UI; на прямой заход — назад на табы (RPC всё равно не отдаст)
  if (session && role !== 'admin') return <Redirect href="/(tabs)/leaderboard" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50">
          {t('leaderboard.moderation')}
          {pending?.length ? ` (${pending.length})` : ''}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#848D9A" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {pending?.length ? (
            pending.map((row) => (
              <PendingCard key={row.entry_id} row={row} onOpenVideo={openVideo} onDone={refresh} />
            ))
          ) : (
            <Text className="py-10 text-center text-sm text-graphite-500">
              {t('leaderboard.moderationEmpty')}
            </Text>
          )}
        </ScrollView>
      )}

      {videoDialog}
    </SafeAreaView>
  );
}
