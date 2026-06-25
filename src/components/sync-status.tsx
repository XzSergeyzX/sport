import { onlineManager, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

// Видимый статус оффлайн-очереди записи (SPEC §4, шаг 4).
// pending = число мутаций в состоянии 'pending' (включая поставленные на паузу в оффлайне) —
// то есть сколько изменений ещё не подтверждено сервером. online — реальное состояние сети.
// Когда всё сохранено и есть сеть — ничего не показываем (без визуального шума).
const SYNCING_DELAY_MS = 700; // онлайн-бейдж показываем, только если запись висит дольше порога

export function SyncStatus() {
  const { t } = useTranslation();
  const pending = useIsMutating();
  const busy = pending > 0;
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);

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

  // Оффлайн — показываем сразу (важный фидбек). Онлайн «синхронізація» — только пока реально
  // идёт запись И она перевалила порог (busy без syncingLong = быстрое сохранение, не мигаем).
  if (online && !(busy && syncingLong)) return null;

  const offline = !online;
  const label = offline
    ? pending > 0
      ? t('sync.offlinePending', { count: pending })
      : t('sync.offline')
    : t('sync.syncing', { count: pending });
  const color = offline ? '#F59E0B' : '#1FB89A';

  return (
    <View
      className="mt-2 flex-row items-center gap-2 self-start rounded-full px-3 py-1"
      style={{ backgroundColor: offline ? 'rgba(245,158,11,0.14)' : 'rgba(31,184,154,0.14)' }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text className="text-xs font-semibold" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
