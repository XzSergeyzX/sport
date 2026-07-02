import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { Segmented } from '@/components/segmented';
import { SettingsButton } from '@/components/settings-button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  bestPerUser,
  type Board,
  deleteEntry,
  type Dynamometer,
  getLeaderboard,
  type GripSetType,
  type LeaderboardRow,
  listDynamometers,
  listMyEntries,
  listPendingEntries,
  type MyEntry,
  reviewEntry,
  rowRgcKg,
  submitEntry,
} from '@/lib/db/leaderboard';
import { type Gripper, gripperLabel, listGripperCatalog } from '@/lib/db/grippers';
import { fromKg, toKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';
import { useRole } from '@/lib/use-role';

const PLACEHOLDER = '#848D9A';
const SET_TYPES: GripSetType[] = ['tns', 'card', 'deep'];
const MEDALS = ['🥇', '🥈', '🥉'];

function parseNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/** Результат строки борда: динамометр — вес в единице юзера; эспандер — модель + RGC в кг. */
function rowResult(r: LeaderboardRow, unit: WeightUnit, t: (k: string) => string): string {
  if (r.weight_kg != null) {
    const v = fromKg(r.weight_kg, unit) as number;
    const rd = Math.round(v * 10) / 10;
    return `${Number.isInteger(rd) ? rd : rd.toFixed(1)} ${t(`common.${unit}`)}`;
  }
  const name = r.gripper_brand ? `${r.gripper_brand} ${r.gripper_name}` : (r.gripper_name ?? '—');
  const kg = rowRgcKg(r);
  return kg != null ? `${name} · ${Math.round(kg)} kg` : name;
}

function openVideo(url: string) {
  Linking.openURL(url).catch(() => {});
}

// ---------- подача заявки ----------

function SubmitForm({
  userId,
  board,
  dynamometers,
  onClose,
}: {
  userId: string;
  board: Board;
  dynamometers: Dynamometer[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const unit = useWeightUnit();

  const [dynId, setDynId] = useState<string | null>(dynamometers[0]?.id ?? null);
  const [weight, setWeight] = useState('');
  const [gripper, setGripper] = useState<Gripper | null>(null);
  const [gripSearch, setGripSearch] = useState('');
  const [setType, setSetType] = useState<GripSetType>('tns');
  const [videoUrl, setVideoUrl] = useState('');
  const [note, setNote] = useState('');

  // каталог эспандеров (личные + глобальные) для выбора железки заявки
  const { data: catalog } = useQuery({
    queryKey: ['gripper-catalog', userId],
    queryFn: () => listGripperCatalog(userId),
    enabled: board === 'gripper',
  });
  const gripMatches = (catalog ?? [])
    .filter((g) => {
      const q = gripSearch.trim().toLowerCase();
      return q.length > 0 && gripperLabel(g, unit).toLowerCase().includes(q);
    })
    .slice(0, 30);

  const weightKg = toKg(parseNum(weight), unit);
  const urlOk = /^https:\/\/\S+\.\S+/.test(videoUrl.trim());
  const canSubmit =
    urlOk &&
    (board === 'dynamometer'
      ? dynId != null && weightKg != null && weightKg > 0 && weightKg < 400
      : gripper != null);

  const submitMut = useMutation({
    mutationFn: () =>
      submitEntry(
        board === 'dynamometer'
          ? { userId, board, dynamometerId: dynId!, weightKg: weightKg!, videoUrl, note }
          : { userId, board, gripperId: gripper!.id, setType, videoUrl, note },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
      onClose();
    },
    onError: (e) => {
      const msg = e instanceof Error && e.message.includes('daily_entry_limit')
        ? t('leaderboard.dailyLimit')
        : t('leaderboard.submitError');
      Alert.alert(msg);
    },
  });

  return (
    <>
      <Text className="text-xl font-extrabold text-graphite-50">
        {t(board === 'dynamometer' ? 'leaderboard.submitDyno' : 'leaderboard.submitGripper')}
      </Text>

      {board === 'dynamometer' ? (
        <>
          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('leaderboard.device')}
          </Text>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {dynamometers.map((d) => {
              const active = dynId === d.id;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => setDynId(d.id)}
                  className="rounded-full px-4 py-2 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>{d.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('leaderboard.result')} ({t(`common.${unit}`)})
          </Text>
          <TextInput
            value={weight}
            onChangeText={setWeight}
            placeholder={unit === 'kg' ? '75' : '165'}
            placeholderTextColor={PLACEHOLDER}
            keyboardType="decimal-pad"
            className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />
        </>
      ) : (
        <>
          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('leaderboard.gripper')}
          </Text>
          {gripper ? (
            <Pressable
              onPress={() => setGripper(null)}
              className="mt-1 flex-row items-center justify-between rounded-xl bg-graphite-800 px-4 py-3 active:opacity-80"
            >
              <Text className="flex-1 text-base text-graphite-50">{gripperLabel(gripper, unit)}</Text>
              <Ionicons name="close" size={18} color={PLACEHOLDER} />
            </Pressable>
          ) : (
            <>
              <TextInput
                value={gripSearch}
                onChangeText={setGripSearch}
                placeholder={t('leaderboard.gripperSearch')}
                placeholderTextColor={PLACEHOLDER}
                className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
              />
              {gripSearch.trim().length > 0 && (
                <View className="mt-1">
                  {gripMatches.map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => {
                        setGripper(g);
                        setGripSearch('');
                      }}
                      className="border-b border-graphite-800 py-2.5 active:opacity-70"
                    >
                      <Text className="text-base text-graphite-100">{gripperLabel(g, unit)}</Text>
                    </Pressable>
                  ))}
                  {gripMatches.length === 0 && (
                    <Text className="py-2 text-sm text-graphite-500">{t('workout.noResults')}</Text>
                  )}
                </View>
              )}
            </>
          )}

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('leaderboard.setType')}
          </Text>
          <View className="mt-1 flex-row gap-2">
            {SET_TYPES.map((s) => {
              const active = setType === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSetType(s)}
                  className="rounded-full px-4 py-2 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>{t(`setTypes.${s}`)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
        {t('leaderboard.videoUrl')}
      </Text>
      <TextInput
        value={videoUrl}
        onChangeText={setVideoUrl}
        placeholder="https://youtube.com/…"
        placeholderTextColor={PLACEHOLDER}
        autoCapitalize="none"
        keyboardType="url"
        className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
      />
      <Text className="mt-1 text-xs leading-4 text-graphite-500">{t('leaderboard.videoHint')}</Text>

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
        {t('leaderboard.note')}
      </Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('leaderboard.notePlaceholder')}
        placeholderTextColor={PLACEHOLDER}
        className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
      />

      <Pressable
        disabled={!canSubmit || submitMut.isPending}
        onPress={() => submitMut.mutate()}
        className="mt-6 items-center rounded-xl bg-accent py-3 active:opacity-80"
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {submitMut.isPending ? (
          <ActivityIndicator color="#0C0E12" />
        ) : (
          <Text className="text-sm font-bold text-graphite-950">{t('leaderboard.submit')}</Text>
        )}
      </Pressable>
    </>
  );
}

// ---------- мои заявки ----------

function MyEntryRow({ entry, onDelete }: { entry: MyEntry; onDelete: () => void }) {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const what =
    entry.board === 'dynamometer'
      ? `${entry.dynamometers?.name ?? '—'} · ${Math.round((fromKg(entry.weight_kg, unit) ?? 0) * 10) / 10} ${t(`common.${unit}`)}`
      : `${entry.grippers?.brand ? `${entry.grippers.brand} ` : ''}${entry.grippers?.name ?? '—'} · ${t(`setTypes.${entry.set_type ?? 'tns'}`)}`;
  const statusColor =
    entry.status === 'approved' ? '#1FB89A' : entry.status === 'rejected' ? '#F87171' : '#EAB308';
  return (
    <View className="mb-2 flex-row items-center rounded-2xl bg-graphite-900 p-3">
      <View className="flex-1">
        <Text className="text-sm font-semibold text-graphite-100">{what}</Text>
        <Text className="mt-0.5 text-xs" style={{ color: statusColor }}>
          {t(`leaderboard.status.${entry.status}`)}
        </Text>
      </View>
      <Pressable onPress={() => openVideo(entry.video_url)} hitSlop={8} className="px-2 active:opacity-60">
        <Ionicons name="logo-youtube" size={18} color={PLACEHOLDER} />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8} className="px-2 active:opacity-60">
        <Ionicons name="trash-outline" size={18} color={PLACEHOLDER} />
      </Pressable>
    </View>
  );
}

// ---------- модерация (admin) ----------

function ModerationRow({ row, onDone }: { row: LeaderboardRow; onDone: () => void }) {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const reviewMut = useMutation({
    mutationFn: (action: 'approved' | 'rejected') => reviewEntry(row.entry_id, action),
    onSuccess: onDone,
  });
  return (
    <View className="mb-2 rounded-2xl bg-graphite-900 p-3">
      <View className="flex-row items-center">
        <Avatar email={row.display_name} avatarKey={row.avatar} size={28} />
        <Text className="ml-2 flex-1 text-sm font-semibold text-graphite-100">{row.display_name}</Text>
        <Pressable onPress={() => openVideo(row.video_url)} hitSlop={8} className="px-1 active:opacity-60">
          <Ionicons name="play-circle-outline" size={22} color="#1FB89A" />
        </Pressable>
      </View>
      <Text className="mt-1 text-sm text-graphite-300">
        {row.set_type ? `${rowResult(row, unit, t)} · ${t(`setTypes.${row.set_type}`)}` : rowResult(row, unit, t)}
      </Text>
      {!!row.note && <Text className="mt-0.5 text-xs text-graphite-500">{row.note}</Text>}
      <View className="mt-2 flex-row gap-2">
        <Pressable
          disabled={reviewMut.isPending}
          onPress={() => reviewMut.mutate('approved')}
          className="flex-1 items-center rounded-xl bg-accent py-2 active:opacity-80"
        >
          <Text className="text-sm font-bold text-graphite-950">{t('leaderboard.approve')}</Text>
        </Pressable>
        <Pressable
          disabled={reviewMut.isPending}
          onPress={() => reviewMut.mutate('rejected')}
          className="flex-1 items-center rounded-xl bg-graphite-800 py-2 active:opacity-80"
        >
          <Text className="text-sm font-semibold text-red-400">{t('leaderboard.reject')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------- экран ----------

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id;
  const unit = useWeightUnit();
  const role = useRole();
  const qc = useQueryClient();

  const [board, setBoard] = useState<Board>('dynamometer');
  const [dynFilter, setDynFilter] = useState<string | null>(null); // name; null = все
  const [setTypeFilter, setSetTypeFilter] = useState<GripSetType>('tns');
  const [submitting, setSubmitting] = useState(false);

  const { data: dynamometers } = useQuery({
    queryKey: ['dynamometers'],
    queryFn: listDynamometers,
    staleTime: 1000 * 60 * 60,
  });
  const { data: rows, isLoading } = useQuery({
    queryKey: ['leaderboard', board],
    queryFn: () => getLeaderboard(board),
  });
  const { data: myEntries } = useQuery({
    queryKey: ['leaderboard-my', userId],
    queryFn: () => listMyEntries(userId as string),
    enabled: !!userId,
  });
  const { data: pending } = useQuery({
    queryKey: ['leaderboard-pending'],
    queryFn: listPendingEntries,
    enabled: role === 'admin',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leaderboard', board] });
    qc.invalidateQueries({ queryKey: ['leaderboard-pending'] });
    qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
  };

  const delMut = useMutation({
    mutationFn: deleteEntry,
    onSuccess: refresh,
  });
  const confirmDelete = (e: MyEntry) =>
    Alert.alert(t('leaderboard.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('grippers.delete'), style: 'destructive', onPress: () => delMut.mutate(e.id) },
    ]);

  // фильтр + лучший результат на юзера
  const filtered = (rows ?? []).filter((r) =>
    board === 'dynamometer'
      ? dynFilter == null || r.dynamometer === dynFilter
      : r.set_type === setTypeFilter,
  );
  const ranked = bestPerUser(filtered, (r) => (board === 'dynamometer' ? r.weight_kg : rowRgcKg(r)));

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-row items-center justify-between px-6 pt-4">
        <Text className="text-2xl font-extrabold text-graphite-50">{t('leaderboard.title')}</Text>
        <SettingsButton />
      </View>

      <View className="px-6 pt-3">
        <Segmented<Board>
          value={board}
          onChange={setBoard}
          options={[
            { value: 'dynamometer', label: t('leaderboard.dyno') },
            { value: 'gripper', label: t('leaderboard.grippers') },
          ]}
        />
      </View>

      <ScrollView className="flex-1 px-6 pt-3" contentContainerStyle={{ paddingBottom: 32 }}>
        {/* фильтры */}
        <View className="flex-row flex-wrap gap-2">
          {board === 'dynamometer' ? (
            <>
              {[null, ...(dynamometers ?? []).map((d) => d.name)].map((name) => {
                const active = dynFilter === name;
                return (
                  <Pressable
                    key={name ?? 'all'}
                    onPress={() => setDynFilter(name)}
                    className="rounded-full px-3 py-1.5 active:opacity-80"
                    style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                  >
                    <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                      {name ?? t('leaderboard.allDevices')}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : (
            SET_TYPES.map((s) => {
              const active = setTypeFilter === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSetTypeFilter(s)}
                  className="rounded-full px-3 py-1.5 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                    {t(`setTypes.${s}`)}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        {/* борд */}
        {isLoading ? (
          <View className="items-center py-12">
            <ActivityIndicator color="#848D9A" />
          </View>
        ) : ranked.length === 0 ? (
          <Text className="py-10 text-center text-sm leading-5 text-graphite-500">
            {t('leaderboard.empty')}
          </Text>
        ) : (
          <View className="mt-3">
            {ranked.map((r, i) => (
              <View
                key={r.entry_id}
                className="mb-2 flex-row items-center rounded-2xl bg-graphite-900 p-3"
                style={i === 0 ? { borderWidth: 1, borderColor: '#1FB89A55' } : undefined}
              >
                <Text className="w-8 text-center text-base font-bold text-graphite-300">
                  {MEDALS[i] ?? i + 1}
                </Text>
                <Avatar email={r.display_name} avatarKey={r.avatar} size={36} />
                <View className="ml-3 flex-1">
                  <Text className="text-base font-semibold text-graphite-100" numberOfLines={1}>
                    {r.display_name}
                  </Text>
                  <Text className="mt-0.5 text-sm text-graphite-400">{rowResult(r, unit, t)}</Text>
                </View>
                <Pressable onPress={() => openVideo(r.video_url)} hitSlop={8} className="pl-2 active:opacity-60">
                  <Ionicons name="play-circle-outline" size={26} color="#1FB89A" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* подать результат */}
        <Pressable
          onPress={() => setSubmitting(true)}
          className="mt-4 items-center rounded-2xl bg-accent py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('leaderboard.submitCta')}</Text>
        </Pressable>

        {/* мои заявки */}
        {!!myEntries?.length && (
          <>
            <Text className="mt-6 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {t('leaderboard.myEntries')}
            </Text>
            <View className="mt-2">
              {myEntries.map((e) => (
                <MyEntryRow key={e.id} entry={e} onDelete={() => confirmDelete(e)} />
              ))}
            </View>
          </>
        )}

        {/* модерация (admin) */}
        {role === 'admin' && !!pending?.length && (
          <>
            <Text className="mt-6 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {t('leaderboard.moderation')} ({pending.length})
            </Text>
            <View className="mt-2">
              {pending.map((row) => (
                <ModerationRow key={row.entry_id} row={row} onDone={refresh} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <BottomSheet visible={submitting} onClose={() => setSubmitting(false)}>
        {userId && submitting && (
          <SubmitForm
            userId={userId}
            board={board}
            dynamometers={dynamometers ?? []}
            onClose={() => {
              setSubmitting(false);
              refresh();
            }}
          />
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}
