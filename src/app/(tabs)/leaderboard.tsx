import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { Segmented } from '@/components/segmented';
import { SettingsButton } from '@/components/settings-button';
import { useAppDialog } from '@/components/use-app-dialog';
import { useConfirmedVideoLink } from '@/components/video-link';
import { useAuth } from '@/lib/auth/auth-context';
import {
  bestPerUser,
  type Board,
  certEligibleGripper,
  certLabels,
  deleteEntry,
  type Dynamometer,
  type DynamometerView,
  getLeaderboard,
  type GripSetType,
  type Hand,
  type LeaderboardRow,
  listDynamometers,
  listMyEntries,
  listPendingEntries,
  type MyEntry,
  rowRgcKg,
  submitEntry,
  VIDEO_HOST_RE,
} from '@/lib/db/leaderboard';
import { type Gripper, gripperLabel, gripperMatches, listGripperCatalog, normSearch } from '@/lib/db/grippers';
import i18n from '@/lib/i18n';
import { useTabBarHeight } from '@/lib/tab-bar';
import { fromKg, toKg, useWeightUnit, type WeightUnit } from '@/lib/use-unit';
import { useRole } from '@/lib/use-role';

const PLACEHOLDER = '#848D9A';
const SET_TYPES: GripSetType[] = ['tns', 'card', 'deep'];
const DYNAMOMETER_VIEWS: Exclude<DynamometerView, 'absolute'>[] = ['device_all', 'left', 'right', 'sum'];
const MEDALS = ['🥇', '🥈', '🥉'];

function parseNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/** Дата энтри строки борда: когда выступил (performed_at), фолбэк — когда подал (created_at). */
function entryDate(r: LeaderboardRow): string | null {
  const iso = r.performed_at ?? r.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/** Результат строки борда: динамометр — вес в единице юзера; эспандер — модель + RGC в кг. */
function displayWeight(kg: number, unit: WeightUnit): string {
  const value = fromKg(kg, unit) as number;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function rowResult(
  r: LeaderboardRow,
  unit: WeightUnit,
  t: (k: string) => string,
  dynamometerView?: DynamometerView,
): string {
  if (r.weight_kg != null) {
    const total = `${displayWeight(r.weight_kg, unit)} ${t(`common.${unit}`)}`;
    if (r.left_weight_kg != null && r.right_weight_kg != null) {
      return `${total} · ${t('leaderboard.leftShort')} ${displayWeight(r.left_weight_kg, unit)} + ${t('leaderboard.rightShort')} ${displayWeight(r.right_weight_kg, unit)}`;
    }
    const device = dynamometerView === 'absolute' && r.dynamometer ? ` · ${r.dynamometer}` : '';
    const hand = r.hand ? ` · ${t(`leaderboard.hand.${r.hand}`)}` : '';
    return `${total}${device}${hand}`;
  }
  const name = r.gripper_brand ? `${r.gripper_brand} ${r.gripper_name}` : (r.gripper_name ?? '—');
  const kg = rowRgcKg(r);
  // RGC на борде всегда в кг (ранжир по кг), юнит — локализованный, как у власної ваги рядом
  return kg != null ? `${name} · RGC: ${Math.round(kg)} ${t('common.kg')}` : name;
}

// ---------- подача заявки ----------

// Дата выступления → ISO yyyy-mm-dd в локальном дне (performed_at — date-колонка, без времени).
// Ввод — нативный датапикер (maximumDate=сегодня), поэтому невалидной/будущей даты не бывает.
const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
  const router = useRouter();
  const unit = useWeightUnit();

  const [dynId, setDynId] = useState<string | null>(dynamometers[0]?.id ?? null);
  const [hand, setHand] = useState<Hand | null>(null);
  const [weight, setWeight] = useState('');
  const [gripper, setGripper] = useState<Gripper | null>(null);
  const [gripSearch, setGripSearch] = useState('');
  const [setType, setSetType] = useState<GripSetType>('tns');
  const [certified, setCertified] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [note, setNote] = useState('');
  const [perfDate, setPerfDate] = useState<Date | null>(null); // null = не указана (поле опционально)
  const [showDatePicker, setShowDatePicker] = useState(false);

  // каталог эспандеров для выбора железки заявки — ДВУМЯ секциями (фидбек Сергея:
  // «всё в куче»): личные замеренные отдельно от каталожных средних
  const { data: catalog } = useQuery({
    queryKey: ['gripper-catalog', userId],
    queryFn: () => listGripperCatalog(userId),
    enabled: board === 'gripper',
  });
  // нормализация «coc 3» → «CoC #3» — общий матчер всех пикеров (см. grippers.ts)
  const q = normSearch(gripSearch);
  const matches = (list: Gripper[]) =>
    list.filter((g) => gripperMatches(g, gripSearch, unit)).slice(0, 25);
  // без поискового запроса показываем только личные (их мало и это обычно то, что нужно)
  const myGrippers = matches((catalog ?? []).filter((g) => !g.is_global));
  const globalGrippers = q.length > 0 ? matches((catalog ?? []).filter((g) => g.is_global)) : [];

  const weightKg = toKg(parseNum(weight), unit);
  // серт валиден только с подходящей железкой: смена гриппера не должна утащить старый флаг
  const canCert = board === 'gripper' && !!gripper && certEligibleGripper(gripper);
  const urlOk = VIDEO_HOST_RE.test(videoUrl.trim());
  const urlLooksFilled = videoUrl.trim().length > 8;
  const performedAt = perfDate ? toYmd(perfDate) : null; // null (не указана) — это ок
  const canSubmit =
    urlOk &&
    (board === 'dynamometer'
      ? dynId != null && hand != null && weightKg != null && weightKg > 0 && weightKg < 400
      : gripper != null);

  const { showDialog, dialog } = useAppDialog();
  const submitMut = useMutation({
    mutationFn: () =>
      submitEntry(
        board === 'dynamometer'
          ? { userId, board, dynamometerId: dynId!, hand: hand!, weightKg: weightKg!, videoUrl, note, certified: false, performedAt }
          : { userId, board, gripperId: gripper!.id, setType, videoUrl, note, certified: canCert && certified, performedAt },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
      onClose();
    },
    onError: (e) => {
      // ошибка PostgREST — простой объект, не instanceof Error (postgrest-js без throwOnError)
      const raw = (e as { message?: unknown } | null)?.message;
      const msg = typeof raw === 'string' && raw.includes('daily_entry_limit')
        ? t('leaderboard.dailyLimit')
        : t('leaderboard.submitError');
      showDialog({ title: msg });
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
            {t('leaderboard.handLabel')}
          </Text>
          <View className="mt-1 flex-row gap-2">
            {(['left', 'right'] as Hand[]).map((side) => {
              const active = hand === side;
              return (
                <Pressable
                  key={side}
                  onPress={() => setHand(side)}
                  className="flex-1 items-center rounded-xl px-4 py-3 active:opacity-80"
                  style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                >
                  <Text className="font-semibold" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                    {t(`leaderboard.hand.${side}`)}
                  </Text>
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
              {myGrippers.length > 0 && (
                <>
                  <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-accent">
                    {t('leaderboard.myGrippersSection')}
                  </Text>
                  {myGrippers.map((g) => (
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
                </>
              )}
              {globalGrippers.length > 0 && (
                <>
                  <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-graphite-500">
                    {t('leaderboard.catalogSection')}
                  </Text>
                  {globalGrippers.map((g) => (
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
                </>
              )}
              {q.length > 0 && myGrippers.length === 0 && globalGrippers.length === 0 && (
                <Text className="py-2 text-sm text-graphite-500">{t('workout.noResults')}</Text>
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

      {/* официальная сертификация существует только у CoC #3/#3.5/#4 (IronMind) — свитч
          показываем строго при выборе такой железки; заявляет атлет, подтверждает админ апрувом */}
      {canCert && (
        <View className="mt-4 flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center pr-3">
            <Ionicons name="ribbon-outline" size={16} color={certified ? '#1FB89A' : PLACEHOLDER} />
            <Text className="ml-2 flex-1 text-sm text-graphite-200">{t('leaderboard.certified')}</Text>
          </View>
          <Switch
            value={certified}
            onValueChange={setCertified}
            trackColor={{ true: '#1FB89A', false: '#3A3F49' }}
            thumbColor="#E5E7EB"
          />
        </View>
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
      {urlLooksFilled && !urlOk ? (
        <Text className="mt-1 text-xs leading-4 text-red-400">{t('leaderboard.videoHostError')}</Text>
      ) : (
        <Text className="mt-1 text-xs leading-4 text-graphite-500">{t('leaderboard.videoHint')}</Text>
      )}
      <Pressable onPress={() => router.push('/proof-rules')} hitSlop={6} className="mt-1 active:opacity-70">
        <Text className="text-xs font-semibold text-accent">{t('leaderboard.proofRulesLink')} ›</Text>
      </Pressable>

      <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
        {t('leaderboard.performedAt')}
      </Text>
      <View className="mt-1 flex-row items-center gap-2">
        <Pressable
          onPress={() => setShowDatePicker(true)}
          className="flex-1 flex-row items-center justify-between rounded-xl bg-graphite-800 px-4 py-3 active:opacity-70"
        >
          <Text className={`text-base ${perfDate ? 'text-graphite-50' : 'text-graphite-500'}`}>
            {perfDate
              ? perfDate.toLocaleDateString(i18n.language === 'uk' ? 'uk-UA' : 'en-GB')
              : t('leaderboard.performedAtPlaceholder')}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={PLACEHOLDER} />
        </Pressable>
        {perfDate && (
          <Pressable
            onPress={() => setPerfDate(null)}
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-xl bg-graphite-800 active:opacity-70"
          >
            <Ionicons name="close" size={18} color={PLACEHOLDER} />
          </Pressable>
        )}
      </View>
      {showDatePicker && (
        <DateTimePicker
          value={perfDate ?? new Date()}
          mode="date"
          maximumDate={new Date()} // будущую дату выступления выбрать нельзя
          onChange={(e: DateTimePickerEvent, d?: Date) => {
            setShowDatePicker(false); // Android: пикер модальный, закрываем в любом исходе
            if (e.type === 'set' && d) setPerfDate(d);
          }}
        />
      )}

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

      {dialog}
    </>
  );
}

// ---------- мои заявки ----------

function MyEntryRow({
  entry,
  onOpenVideo,
  onDelete,
}: {
  entry: MyEntry;
  onOpenVideo: (url: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const unit = useWeightUnit();
  const what =
    entry.board === 'dynamometer'
      ? `${entry.dynamometers?.name ?? '—'} · ${Math.round((fromKg(entry.weight_kg, unit) ?? 0) * 10) / 10} ${t(`common.${unit}`)}${entry.hand ? ` · ${t(`leaderboard.hand.${entry.hand}`)}` : ''}`
      : `${entry.grippers?.brand ? `${entry.grippers.brand} ` : ''}${entry.grippers?.name ?? '—'} · ${t(`setTypes.${entry.set_type ?? 'tns'}`)}`;
  const statusColor =
    entry.status === 'approved' ? '#1FB89A' : entry.status === 'rejected' ? '#F87171' : '#EAB308';
  return (
    <View className="mb-2 flex-row items-center rounded-2xl bg-graphite-900 p-3">
      <View className="flex-1">
        <View className="flex-row items-center">
          <Text className="text-sm font-semibold text-graphite-100">{what}</Text>
          {entry.certified && (
            <Ionicons name="ribbon-outline" size={14} color="#1FB89A" style={{ marginLeft: 6 }} />
          )}
        </View>
        <Text className="mt-0.5 text-xs" style={{ color: statusColor }}>
          {t(`leaderboard.status.${entry.status}`)}
        </Text>
      </View>
      <Pressable onPress={() => onOpenVideo(entry.video_url)} hitSlop={8} className="px-2 active:opacity-60">
        <Ionicons name="logo-youtube" size={18} color={PLACEHOLDER} />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8} className="px-2 active:opacity-60">
        <Ionicons name="trash-outline" size={18} color={PLACEHOLDER} />
      </Pressable>
    </View>
  );
}

// ---------- экран ----------

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const unit = useWeightUnit();
  const role = useRole();
  const tabBarHeight = useTabBarHeight();
  const qc = useQueryClient();
  const { openVideo, videoDialog } = useConfirmedVideoLink();
  const { showDialog, dialog } = useAppDialog();

  const [board, setBoard] = useState<Board>('dynamometer');
  const [dynFilter, setDynFilter] = useState<string | null>(null); // stable code; null = справочник ещё грузится
  const [dynView, setDynView] = useState<DynamometerView>('device_all');
  const [setTypeFilter, setSetTypeFilter] = useState<GripSetType>('tns');
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null); // тап по строке → дата энтри

  const { data: dynamometers, isLoading: isDynamometersLoading } = useQuery({
    // v2 сбрасывает часовой persisted-кэш общей XF-300 после разделения 14/18 мм.
    queryKey: ['dynamometers', 'v2'],
    queryFn: listDynamometers,
    staleTime: 1000 * 60 * 60,
  });
  const selectedDynCode = dynFilter ?? dynamometers?.[0]?.code ?? null;
  const queryDynCode = dynView === 'absolute' ? null : selectedDynCode;
  const { data: rows, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['leaderboard', board, board === 'dynamometer' ? [dynView, queryDynCode] : setTypeFilter],
    queryFn: () => getLeaderboard(board, queryDynCode, setTypeFilter, dynView),
    enabled: board !== 'dynamometer' || dynView === 'absolute' || selectedDynCode != null,
  });
  // серт-лейблы живут в заявках эспандерного борда, но показываем их и на динамометре
  // (тот же queryKey, что и основной запрос при board==='gripper' — второго фетча нет)
  const { data: gripRows } = useQuery({
    queryKey: ['leaderboard', 'gripper'],
    queryFn: () => getLeaderboard('gripper'),
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
    qc.invalidateQueries({ queryKey: ['leaderboard'] }); // оба борда: серт-лейблы общие
    qc.invalidateQueries({ queryKey: ['leaderboard-pending'] });
    qc.invalidateQueries({ queryKey: ['leaderboard-my', userId] });
  };

  const delMut = useMutation({
    mutationFn: deleteEntry,
    onSuccess: refresh,
  });
  const confirmDelete = (e: MyEntry) =>
    showDialog({
      title: t('leaderboard.deleteConfirm'),
      confirmLabel: t('grippers.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => delMut.mutate(e.id),
    });

  // фильтр + лучший результат на юзера
  const ranked = bestPerUser(rows ?? [], (r) => (board === 'dynamometer' ? r.weight_kg : rowRgcKg(r)));
  // «CoC 3, 3.5 Certified» у ника — из всех approved-заявок эспандерного борда (видно на обоих)
  const certByUser = certLabels(gripRows ?? []);

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

      <ScrollView
        className="flex-1 px-6 pt-3"
        contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              refresh();
            }}
            tintColor="#848D9A"
          />
        }
      >
        {/* фильтры */}
        {board === 'dynamometer' ? (
          <View>
            <View className="flex-row flex-wrap gap-2">
              {DYNAMOMETER_VIEWS.map((view) => {
                const active = dynView === view;
                return (
                  <Pressable
                    key={view}
                    onPress={() => setDynView(view)}
                    className="rounded-full px-3 py-2 active:opacity-80"
                    style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                      {t(`leaderboard.views.${view}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => setDynView('absolute')}
              className="mt-2 flex-row items-center justify-center rounded-xl border px-4 py-2.5 active:opacity-80"
              style={{
                borderColor: dynView === 'absolute' ? '#1FB89A' : '#3A3F49',
                backgroundColor: dynView === 'absolute' ? 'rgba(31,184,154,0.12)' : 'rgba(255,255,255,0.025)',
              }}
            >
              <Ionicons name="flash" size={15} color={dynView === 'absolute' ? '#1FB89A' : '#848D9A'} />
              <Text className={`ml-2 text-sm font-bold ${dynView === 'absolute' ? 'text-accent' : 'text-graphite-300'}`}>
                {t('leaderboard.views.absolute')}
              </Text>
              <Text className="ml-2 text-xs text-graphite-500">{t('leaderboard.absoluteHint')}</Text>
            </Pressable>

            {dynView !== 'absolute' && (
              <View className="mt-3 flex-row flex-wrap gap-2">
              {(dynamometers ?? []).map((device) => {
                const active = selectedDynCode === device.code;
                return (
                  <Pressable
                    key={device.code}
                    onPress={() => setDynFilter(device.code)}
                    className="rounded-full px-3 py-1.5 active:opacity-80"
                    style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
                  >
                    <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
                      {device.name}
                    </Text>
                  </Pressable>
                );
              })}
              </View>
            )}
          </View>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {SET_TYPES.map((s) => {
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
            })}
          </View>
        )}

        {/* борд */}
        {isLoading || (board === 'dynamometer' && dynView !== 'absolute' && isDynamometersLoading) ? (
          <View className="items-center py-12">
            <ActivityIndicator color="#848D9A" />
          </View>
        ) : ranked.length === 0 ? (
          <Text className="py-10 text-center text-sm leading-5 text-graphite-500">
            {t('leaderboard.empty')}
          </Text>
        ) : (
          <View className="mt-3">
            {ranked.map((r, i) => {
              const cert = certByUser.get(r.user_id);
              const bw = r.bodyweight != null ? Math.round(fromKg(r.bodyweight, unit) as number) : null;
              const mine = r.user_id === userId;
              const date = entryDate(r);
              const expanded = expandedId === r.entry_id;
              return (
                <Pressable
                  key={r.entry_id}
                  onPress={() => setExpandedId(expanded ? null : r.entry_id)}
                  className="mb-2 flex-row items-center rounded-2xl bg-graphite-900 p-3 active:opacity-90"
                  // подсветка — СВОЯ позиция, а не первая (первую и так видно по медали)
                  style={mine ? { borderWidth: 1, borderColor: '#1FB89A88' } : undefined}
                >
                  <Text
                    className="w-9 text-center font-bold text-graphite-300"
                    style={{ fontSize: i < 3 ? 24 : 15 }}
                  >
                    {MEDALS[i] ?? i + 1}
                  </Text>
                  <Avatar email={r.display_name} avatarKey={r.avatar} size={36} />
                  <View className="ml-3 flex-1">
                    <View className="flex-row items-center">
                      <Text className="text-base font-semibold text-graphite-100" numberOfLines={1}>
                        {r.display_name}
                      </Text>
                      {!!cert && (
                        <Text className="ml-2 text-xs italic text-accent" numberOfLines={1}>
                          {cert}
                        </Text>
                      )}
                    </View>
                    <Text className="mt-0.5 text-sm text-graphite-400">
                      {rowResult(r, unit, t, board === 'dynamometer' ? dynView : undefined)}
                      {bw != null && (
                        <Text className="text-graphite-600">
                          {'  ·  '}
                          {t('leaderboard.bwShort')} {bw} {t(`common.${unit}`)}
                        </Text>
                      )}
                    </Text>
                    {expanded && date != null && (
                      <Text className="mt-1 text-xs text-graphite-500">
                        {t('leaderboard.entryDate')}: {date}
                      </Text>
                    )}
                  </View>
                  {r.left_video_url && r.right_video_url ? (
                    <View className="ml-1 flex-row">
                      <Pressable onPress={() => openVideo(r.left_video_url!)} hitSlop={6} className="items-center px-1 active:opacity-60">
                        <Text className="text-[10px] font-bold text-graphite-500">{t('leaderboard.leftShort')}</Text>
                        <Ionicons name="play-circle-outline" size={22} color="#1FB89A" />
                      </Pressable>
                      <Pressable onPress={() => openVideo(r.right_video_url!)} hitSlop={6} className="items-center px-1 active:opacity-60">
                        <Text className="text-[10px] font-bold text-graphite-500">{t('leaderboard.rightShort')}</Text>
                        <Ionicons name="play-circle-outline" size={22} color="#1FB89A" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => openVideo(r.video_url)} hitSlop={8} className="pl-2 active:opacity-60">
                      <Ionicons name="play-circle-outline" size={26} color="#1FB89A" />
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* подать результат */}
        <Pressable
          onPress={() => setSubmitting(true)}
          className="mt-4 items-center rounded-2xl bg-accent py-4 active:opacity-80"
        >
          <Text className="text-base font-bold text-graphite-950">{t('leaderboard.submitCta')}</Text>
        </Pressable>

        {/* админ-панель — отдельным экраном (не мешаем публичный борд с модерацией) */}
        {role === 'admin' && (
          <Pressable
            onPress={() => router.push('/moderation')}
            className="mt-3 flex-row items-center justify-center rounded-2xl border border-graphite-700 py-3.5 active:opacity-70"
          >
            <Ionicons name="shield-checkmark-outline" size={18} color="#848D9A" />
            <Text className="ml-2 text-sm font-semibold text-graphite-200">
              {t('leaderboard.moderation')}
              {pending?.length ? ` (${pending.length})` : ''}
            </Text>
          </Pressable>
        )}

        {/* мои заявки */}
        {!!myEntries?.length && (
          <>
            <Text className="mt-6 text-xs font-semibold uppercase tracking-wide text-graphite-500">
              {t('leaderboard.myEntries')}
            </Text>
            <View className="mt-2">
              {myEntries.map((e) => (
                <MyEntryRow key={e.id} entry={e} onOpenVideo={openVideo} onDelete={() => confirmDelete(e)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {videoDialog}
      {dialog}

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
