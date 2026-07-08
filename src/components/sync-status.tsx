import {
  onlineManager,
  useIsMutating,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

// Видимый статус оффлайн-очереди записи (SPEC §4, шаг 4).
// pending = число мутаций в состоянии 'pending' (включая поставленные на паузу в оффлайне) —
// то есть сколько изменений ещё не подтверждено сервером. online — реальное состояние сети.
// failed = число durable-мутаций логирования, упавших после исчерпания retry (см. ниже).
// Когда всё сохранено, провалов нет и есть сеть — ничего не показываем (без визуального шума).
const SYNCING_DELAY_MS = 700; // онлайн-бейдж показываем, только если запись висит дольше порога

export function SyncStatus() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const pending = useIsMutating();
  const busy = pending > 0;
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);

  // Провалившиеся durable-мутации логирования: fuzzy-match по mutationKey (['workout', …]) +
  // status==='error'. Ключ каждой такой мутации начинается с 'workout'; у coach-мутации ключа
  // нет вовсе → сюда не попадает. При ошибке дерево тренировки мы НЕ инвалидируем
  // (workout-mutations.ts), поэтому оптимистика ещё на экране, а этот бейдж честно сообщает, что
  // серверу правка не доехала, и по тапу переигрывает упавшие записи.
  const failedCount = useMutationState({
    filters: { mutationKey: ['workout'], status: 'error' },
  }).length;
  const failed = failedCount > 0;

  // Антимигание: при онлайне быстрые сохранения (sub-second) не должны вспыхивать бейджем и
  // дёргать раскладку на каждый тап. Показываем «синхронізація» лишь когда запись висит дольше
  // порога (реальный бэклог/медленная сеть). Зависим от boolean busy, а не от счётчика, иначе
  // изменение pending 1↔2 сбрасывало бы таймер и бейдж не появлялся бы и при долгой записи.
  const [syncingLong, setSyncingLong] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSyncingLong(false);
      return;
    }
    const id = setTimeout(() => setSyncingLong(true), SYNCING_DELAY_MS);
    return () => clearTimeout(id);
  }, [busy]);

  // Ручной повтор провалившихся записей. Свежую мутацию строим из опций упавшей, но БЕЗ onMutate:
  // оптимистика уже в кэше (на ошибке её не откатываем), а повторный onMutate задвоил бы аддитивные
  // патчи (добавленный подход/упражнение). Сама запись идемпотентна (upsert по client-id,
  // update/delete идемпотентны) → прямой повтор mutationFn безопасен. Старую упавшую убираем, иначе
  // её 'error'-статус держал бы бейдж; на успехе сработает onSuccess из defaults → инвалидация дерева.
  const retryFailed = () => {
    const cache = qc.getMutationCache();
    cache
      .getAll()
      .filter((m) => m.state.status === 'error' && m.options.mutationKey?.[0] === 'workout')
      .forEach((m) => {
        const fresh = cache.build(qc, { ...m.options, onMutate: undefined });
        cache.remove(m);
        // .catch: сами по себе mutate() глушит реджект (.catch(noop)), а прямой execute — нет;
        // провал и так залогирует глобальный MutationCache.onError, а статус обновит бейдж.
        fresh.execute(m.state.variables).catch(() => {});
      });
  };

  // Приоритет: оффлайн (досинкать сейчас нельзя) → провал (нужен ручной повтор) → «синхронізація»
  // (запись идёт). Всё сохранено, провалов нет и есть сеть — не показываем ничего.
  let label: string;
  let color: string;
  let bg: string;
  let onPress: (() => void) | undefined;
  if (!online) {
    label = pending > 0 ? t('sync.offlinePending', { count: pending }) : t('sync.offline');
    color = '#F59E0B';
    bg = 'rgba(245,158,11,0.14)';
  } else if (failed) {
    label = t('sync.failed', { count: failedCount });
    color = '#E5484D';
    bg = 'rgba(229,72,77,0.14)';
    onPress = retryFailed;
  } else if (busy && syncingLong) {
    label = t('sync.syncing', { count: pending });
    color = '#1FB89A';
    bg = 'rgba(31,184,154,0.14)';
  } else {
    return null;
  }

  const badge = (
    <View
      className="mt-2 flex-row items-center gap-2 self-start rounded-full px-3 py-1"
      style={{ backgroundColor: bg }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text className="text-xs font-semibold" style={{ color }}>
        {label}
      </Text>
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} className="self-start active:opacity-70">
      {badge}
    </Pressable>
  ) : (
    badge
  );
}
