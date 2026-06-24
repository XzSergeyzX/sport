import { onlineManager, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

// Видимый статус оффлайн-очереди записи (SPEC §4, шаг 4).
// pending = число мутаций в состоянии 'pending' (включая поставленные на паузу в оффлайне) —
// то есть сколько изменений ещё не подтверждено сервером. online — реальное состояние сети.
// Когда всё сохранено и есть сеть — ничего не показываем (без визуального шума).
export function SyncStatus() {
  const { t } = useTranslation();
  const pending = useIsMutating();
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(() => setOnline(onlineManager.isOnline())), []);

  if (online && pending === 0) return null;

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
