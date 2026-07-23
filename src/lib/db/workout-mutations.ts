// Дефолты мутаций логирования тренировки, зарегистрированные на QueryClient (SPEC §4, шаг 2).
// Зачем централизованно, а не в компоненте: персист (PersistQueryClientProvider) сохраняет
// поставленные на паузу оффлайн-мутации, но у восстановленной мутации НЕТ функций (mutationFn/
// onMutate/onSuccess) — их react-query берёт из mutation defaults по mutationKey. Поэтому, чтобы
// запись пережила полный перезапуск приложения и доигралась на реконнекте, fn+оптимистика
// должны жить в defaults, а компонент лишь зовёт useMutation({ mutationKey }).
//
// Оптимистика пишет прямо в кэш дерева тренировки ['workout', workoutId] → мгновенный UI и работа
// оффлайн. Реконсиляция — через onSuccess→invalidate: при УСПЕХЕ refetch подтягивает серверную
// правду. При ОШИБКЕ намеренно НЕ инвалидируем — рефетч стёр бы оптимистичную запись с экрана без
// следа (юзер её уже видел и ждёт, что сохранится); оставляем оптимистику в кэше, а провал виден
// через бейдж SyncStatus (оттуда же — ручной повтор). При оффлайне мутация на паузе, onSuccess ещё
// не наступил — оптимистика тоже остаётся. Снапшот для отката не храним (тяжело и для cross-restart
// бессмысленно) — при повторе источником истины остаётся сервер.
import type { QueryClient } from '@tanstack/react-query';

import type { Exercise } from './exercises';
import {
  ActiveWorkoutExistsError,
  addSet,
  addWorkoutExercise,
  deleteSet,
  deleteWorkoutExercise,
  finishWorkout,
  persistStartedWorkout,
  rescheduledWorkoutTimes,
  reorderWorkoutExercises,
  setExerciseDone,
  setSetLogged,
  updateWorkoutSchedule,
  updateSet,
} from './workouts';
import type { SetInput, SetRow, WorkoutDetail, WorkoutSummary } from './workouts';

export const SET_ADD = ['workout', 'set', 'add'] as const;
export const SET_UPDATE = ['workout', 'set', 'update'] as const;
export const SET_DELETE = ['workout', 'set', 'delete'] as const;
export const SET_LOG = ['workout', 'set', 'log'] as const;
// Старт тренировки из программы. Оптимистичный посев дерева делает экран (синхронно, до
// навигации) — здесь только серверная запись + реконсиляция; персист по mutationKey даёт
// доживание записи через перезапуск, как у логирования подходов.
export const WORKOUT_START = ['workout', 'start'] as const;
// Структурные мутации дерева тренировки — тоже offline-durable (оптимистика + доживание рестарта).
export const WE_ADD = ['workout', 'exercise', 'add'] as const;
export const WE_REMOVE = ['workout', 'exercise', 'remove'] as const;
export const WE_REORDER = ['workout', 'exercise', 'reorder'] as const;
export const WE_DONE = ['workout', 'exercise', 'done'] as const;
export const WORKOUT_FINISH = ['workout', 'finish'] as const;
export const WORKOUT_RESCHEDULE = ['workout', 'reschedule'] as const;

/** Все durable-операции одной тренировки делят scope: родитель создаётся раньше ребёнка,
 * INSERT set раньше UPDATE/LOG/DELETE, а FINISH идёт после последних правок. */
export const workoutMutationScope = (workoutId: string) => ({
  id: `workout-${workoutId}-sets`,
});

// Таймстемпы действий (completedAt/at/endedAt) едут В vars, а не вычисляются в mutationFn:
// у queued-оффлайн-мутации mutationFn исполняется в момент РЕКОННЕКТА (возможно через сутки),
// и new Date() там записал бы на сервер время синка вместо времени тапа.
export type AddSetVars = {
  workoutId: string;
  weId: string;
  input: SetInput;
  id: string;
  completedAt: string;
};
export type UpdateSetVars = { workoutId: string; id: string; input: SetInput };
export type DeleteSetVars = { workoutId: string; setId: string };
export type LogSetVars = {
  workoutId: string;
  id: string;
  logged: boolean;
  restSec: number | null;
  at: string;
};
export type AddWeVars = {
  workoutId: string;
  id: string;
  exerciseId: string;
  orderIndex: number;
  exercise: Exercise | null;
};
export type RemoveWeVars = { workoutId: string; ids: string[] };
export type ReorderWeVars = { workoutId: string; ids: string[]; orders: number[] };
export type DoneWeVars = { workoutId: string; weId: string; done: boolean; at: string };
export type FinishVars = { workoutId: string; endedAt: string };
export type RescheduleVars = { workoutId: string; startedAt: string };

/** UPDATE должен попасть в durable-очередь раньше LOG того же подхода. */
export function enqueueSetDraftMutations(
  enqueueUpdate: (vars: UpdateSetVars) => void,
  enqueueLog: () => void,
  vars: UpdateSetVars,
  shouldLog: boolean,
): void {
  enqueueUpdate(vars);
  if (shouldLog) enqueueLog();
}

const wkey = (workoutId: string) => ['workout', workoutId];

// Ретрай транзиентных сбоев — ТОЛЬКО у durable-мутаций логирования: единичный сетевой blip
// на реконнекте не должен безвозвратно ронять запись из очереди. Повторять безопасно — эти
// записи идемпотентны (создание — upsert по клиентскому id, апдейты/удаления идемпотентны
// сами). Глобального ретрая мутаций НЕТ намеренно: неидемпотентные insert'ы (заявка борда,
// кастомна вправа) задваивались бы, а платные ИИ-вызовы дважды списывали бы кост.
const durableRetry = {
  retry: (failureCount: number, error: Error) =>
    !(error instanceof ActiveWorkoutExistsError) && failureCount < 3,
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000),
};

/** Убрать локальную phantom-тренировку, которую БД отклонила из-за уже активной сессии. */
export function discardConflictingWorkout(qc: QueryClient, workout: WorkoutDetail): void {
  qc.removeQueries({ queryKey: wkey(workout.id), exact: true });
  qc.setQueriesData<WorkoutSummary[]>({ queryKey: ['workouts'] }, (old) =>
    old?.filter((item) => item.id !== workout.id),
  );
  qc.invalidateQueries({ queryKey: ['workouts'] });
}

/** Создать START mutation с динамическим scope конкретной тренировки. Обычный useMutation
 * задаёт scope на уровне hook и не может узнать client UUID, который создаётся только по тапу. */
export function enqueueWorkoutStart(
  qc: QueryClient,
  workout: WorkoutDetail,
  onConflict: (activeWorkoutId: string) => void,
): void {
  const mutation = qc.getMutationCache().build<void, Error, WorkoutDetail, unknown>(qc, {
    mutationKey: WORKOUT_START,
    scope: workoutMutationScope(workout.id),
    onError: (error, variables) => {
      if (!(error instanceof ActiveWorkoutExistsError)) return;
      discardConflictingWorkout(qc, variables);
      onConflict(error.activeWorkoutId);
    },
  });
  // useMutation.mutate тоже намеренно глотает rejected promise: состояние ошибки остаётся
  // в MutationCache/SyncStatus, но не превращается в unhandled rejection.
  void mutation.execute(workout).catch(() => {});
}

export function registerWorkoutMutationDefaults(qc: QueryClient): void {
  const patch = (workoutId: string, fn: (w: WorkoutDetail) => WorkoutDetail) =>
    qc.setQueryData<WorkoutDetail>(wkey(workoutId), (old) => (old ? fn(old) : old));
  const mapSet = (w: WorkoutDetail, setId: string, fn: (s: SetRow) => SetRow): WorkoutDetail => ({
    ...w,
    workout_exercises: w.workout_exercises.map((we) => ({
      ...we,
      sets: we.sets.map((s) => (s.id === setId ? fn(s) : s)),
    })),
  });
  const cancel = (workoutId: string) => qc.cancelQueries({ queryKey: wkey(workoutId) });
  const settle = (workoutId: string) => qc.invalidateQueries({ queryKey: wkey(workoutId) });

  qc.setMutationDefaults(SET_ADD, {
    ...durableRetry,
    mutationFn: (v: AddSetVars) => addSet(v.weId, v.input, v.id, v.completedAt),
    onMutate: async (v: AddSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: w.workout_exercises.map((we) =>
          we.id === v.weId
            ? {
                ...we,
                sets: [
                  ...we.sets,
                  {
                    id: v.id,
                    workout_exercise_id: v.weId,
                    reps: v.input.reps ?? null,
                    duration_sec: v.input.duration_sec ?? null,
                    weight: v.input.weight ?? null,
                    rest_sec: v.input.rest_sec ?? null,
                    rpe: v.input.rpe ?? null,
                    note: null,
                    meta: (v.input.meta as Record<string, unknown> | null) ?? null,
                    completed_at: v.completedAt,
                    logged_at: null,
                  },
                ],
              }
            : we,
        ),
      }));
    },
    onSuccess: (_d, v: AddSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(SET_UPDATE, {
    ...durableRetry,
    mutationFn: (v: UpdateSetVars) => updateSet(v.id, v.input),
    onMutate: async (v: UpdateSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => mapSet(w, v.id, (s) => ({ ...s, ...v.input }) as SetRow));
    },
    onSuccess: (_d, v: UpdateSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(SET_DELETE, {
    ...durableRetry,
    mutationFn: (v: DeleteSetVars) => deleteSet(v.setId),
    onMutate: async (v: DeleteSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: w.workout_exercises.map((we) => ({
          ...we,
          sets: we.sets.filter((s) => s.id !== v.setId),
        })),
      }));
    },
    onSuccess: (_d, v: DeleteSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WORKOUT_START, {
    ...durableRetry,
    mutationFn: (d: WorkoutDetail) => persistStartedWorkout(d),
    // оптимистику в ['workout', id] и ['workouts'] кладёт экран программы синхронно — здесь не
    // дублируем (onMutate из восстановленной мутации не вызовется; кэш и так персистится).
    onSuccess: (_data, d: WorkoutDetail) => {
      qc.invalidateQueries({ queryKey: wkey(d.id) });
      qc.invalidateQueries({ queryKey: ['workouts'] });
    },
    onError: (error, d: WorkoutDetail) => {
      if (error instanceof ActiveWorkoutExistsError) discardConflictingWorkout(qc, d);
    },
  });

  qc.setMutationDefaults(WE_ADD, {
    ...durableRetry,
    mutationFn: (v: AddWeVars) => addWorkoutExercise(v.workoutId, v.exerciseId, v.orderIndex, v.id),
    onMutate: async (v: AddWeVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: [
          ...w.workout_exercises,
          {
            id: v.id,
            workout_id: v.workoutId,
            exercise_id: v.exerciseId,
            order_index: v.orderIndex,
            done_at: null,
            block_key: null,
            block_label: null,
            block_rounds: null,
            block_type: null,
            block_interval_sec: null,
            display_name: null,
            exercise: v.exercise,
            sets: [],
          },
        ],
      }));
    },
    onSuccess: (_d, v: AddWeVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WE_REMOVE, {
    ...durableRetry,
    mutationFn: (v: RemoveWeVars) => Promise.all(v.ids.map(deleteWorkoutExercise)).then(() => {}),
    onMutate: async (v: RemoveWeVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: w.workout_exercises.filter((we) => !v.ids.includes(we.id)),
      }));
    },
    onSuccess: (_d, v: RemoveWeVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WE_REORDER, {
    ...durableRetry,
    mutationFn: (v: ReorderWeVars) => reorderWorkoutExercises(v.ids, v.orders),
    onMutate: async (v: ReorderWeVars) => {
      await cancel(v.workoutId);
      const orderById = new Map(v.ids.map((id, k) => [id, v.orders[k]]));
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: w.workout_exercises
          .map((we) => (orderById.has(we.id) ? { ...we, order_index: orderById.get(we.id)! } : we))
          .sort((a, b) => a.order_index - b.order_index),
      }));
    },
    onSuccess: (_d, v: ReorderWeVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WE_DONE, {
    ...durableRetry,
    mutationFn: (v: DoneWeVars) => setExerciseDone(v.weId, v.done, v.at),
    onMutate: async (v: DoneWeVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => ({
        ...w,
        workout_exercises: w.workout_exercises.map((we) =>
          we.id === v.weId ? { ...we, done_at: v.done ? v.at : null } : we,
        ),
      }));
    },
    onSuccess: (_d, v: DoneWeVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WORKOUT_FINISH, {
    ...durableRetry,
    mutationFn: (v: FinishVars) => finishWorkout(v.workoutId, v.endedAt),
    // ended_at ставим только если ещё не завершена — как finishWorkout (правка завершённой
    // не должна раздувать длительность). Навигацию на сводку делает экран сразу по тапу
    // (offline-first): запись уходит фоном/из очереди, экран не ждёт сети.
    onMutate: async (v: FinishVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => (w.ended_at ? w : { ...w, ended_at: v.endedAt }));
      qc.setQueriesData<WorkoutSummary[]>({ queryKey: ['workouts'] }, (old) =>
        old?.map((item) =>
          item.id === v.workoutId && !item.ended_at ? { ...item, ended_at: v.endedAt } : item,
        ),
      );
    },
    onSuccess: (_d, v: FinishVars) => {
      settle(v.workoutId);
      qc.invalidateQueries({ queryKey: ['workouts'] });
      // завершённая тренировка меняет тоннаж/рекорды → сводка аналитики (RPC) устарела
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  qc.setMutationDefaults(WORKOUT_RESCHEDULE, {
    ...durableRetry,
    mutationFn: (v: RescheduleVars) => updateWorkoutSchedule(v.workoutId, v.startedAt),
    onMutate: async (v: RescheduleVars) => {
      await cancel(v.workoutId);
      const shift = <T extends { started_at: string; ended_at: string | null }>(item: T): T => ({
        ...item,
        ...rescheduledWorkoutTimes(item.started_at, item.ended_at, v.startedAt),
      });
      patch(v.workoutId, shift);
      qc.setQueriesData<WorkoutSummary[]>({ queryKey: ['workouts'] }, (old) =>
        old
          ?.map((item) => (item.id === v.workoutId ? shift(item) : item))
          .sort((a, b) => b.started_at.localeCompare(a.started_at)),
      );
    },
    onSuccess: (_d, v: RescheduleVars) => {
      settle(v.workoutId);
      qc.invalidateQueries({ queryKey: ['workouts'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  qc.setMutationDefaults(SET_LOG, {
    ...durableRetry,
    mutationFn: (v: LogSetVars) => setSetLogged(v.id, v.logged, v.restSec, v.at),
    onMutate: async (v: LogSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) =>
        mapSet(w, v.id, (s) => ({
          ...s,
          logged_at: v.logged ? v.at : null,
          rest_sec: v.logged ? v.restSec : null,
        })),
      );
    },
    onSuccess: (_d, v: LogSetVars) => settle(v.workoutId),
  });
}
