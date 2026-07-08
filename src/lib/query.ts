// Offline-first инфраструктура TanStack Query (SPEC §4).
// - onlineManager слушает РЕАЛЬНУЮ сеть (NetInfo), а не только фокус приложения → мутации
//   корректно ставятся на паузу в оффлайне и сами доигрываются на реконнекте.
// - networkMode:'offlineFirst' — запросы отдают кэш и не висят в оффлайне; мутации не падают,
//   а ждут сети.
// - Кэш персистится в AsyncStorage (createAsyncStoragePersister) → чтения доступны после
//   перезапуска без сети. gcTime длинный, иначе персист нечего хранить.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { MutationCache, onlineManager, QueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

import { registerWorkoutMutationDefaults } from './db/workout-mutations';

const DAY = 1000 * 60 * 60 * 24;

onlineManager.setEventListener((setOnline) => {
  const sub = NetInfo.addEventListener((state) => {
    // isConnected=null трактуем как «онлайн» (неизвестно ≠ оффлайн), чтобы не блокировать запись
    setOnline(state.isConnected !== false);
  });
  return () => sub();
});

// Глобальный лог сбоя мутации: без него упавшая durable-запись (после исчерпания retry) исчезала бы
// бесшумно — ни следа в консоли, ни где-либо. Тостов/алертов тут намеренно нет (глобально это шум) —
// видимую подсказку о провале и ручной повтор даёт бейдж SyncStatus, здесь только след для отладки.
const mutationCache = new MutationCache({
  onError: (error, _vars, _ctx, mutation) => {
    console.warn('[mutation] failed', mutation.options.mutationKey, error);
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst',
      gcTime: DAY, // держим кэш сутки → есть что персистить и показывать оффлайн
      staleTime: 1000 * 30,
      retry: 2,
    },
    mutations: {
      // 'online' (дефолт, но фиксируем явно): в оффлайне мутация НЕ выполняется, а ставится на
      // паузу (onMutate с оптимистикой при этом отрабатывает сразу) и сама доигрывается на
      // реконнекте — это и есть очередь записи.
      networkMode: 'online',
      // Ретрая ГЛОБАЛЬНО нет (дефолт 0): среди мутаций есть неидемпотентные insert'ы (заявка
      // борда, кастомна вправа) и платные ИИ-вызовы — повтор задваивал бы данные/кост.
      // Ретрай транзиентных сбоев есть точечно у идемпотентных durable-мутаций логирования —
      // см. durableRetry в db/workout-mutations.ts.
    },
  },
});

// Регистрируем дефолты мутаций логирования ДО восстановления персиста — чтобы оффлайн-мутации,
// сохранённые в прошлой сессии, нашли свой mutationFn и доигрались на реконнекте (SPEC §4, шаг 2).
registerWorkoutMutationDefaults(queryClient);

export const asyncPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  throttleTime: 1000,
});

/** Полностью сбросить кэш и его персист-снимок (на выходе из аккаунта — чтобы данные одного
 *  юзера не утекли следующему на том же устройстве). */
export async function resetQueryCache(): Promise<void> {
  queryClient.clear();
  await asyncPersister.removeClient();
}
