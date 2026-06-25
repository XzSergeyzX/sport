// Дефолты мутаций логирования тренировки, зарегистрированные на QueryClient (SPEC §4, шаг 2).
// Зачем централизованно, а не в компоненте: персист (PersistQueryClientProvider) сохраняет
// поставленные на паузу оффлайн-мутации, но у восстановленной мутации НЕТ функций (mutationFn/
// onMutate/onSettled) — их react-query берёт из mutation defaults по mutationKey. Поэтому, чтобы
// запись пережила полный перезапуск приложения и доигралась на реконнекте, fn+оптимистика
// должны жить в defaults, а компонент лишь зовёт useMutation({ mutationKey }).
//
// Оптимистика пишет прямо в кэш дерева тренировки ['workout', workoutId] → мгновенный UI и работа
// оффлайн. Реконсиляция — через onSettled→invalidate: при онлайне refetch подтянет правду с
// сервера (и для успеха, и для ошибки); при оффлайне onSettled не сработает, пока мутация на паузе,
// — оптимистика остаётся. Снапшот для отката не храним (тяжело и для cross-restart бессмысленно) —
// источником истины при ошибке выступает сервер.
import type { QueryClient } from '@tanstack/react-query';

import { addSet, deleteSet, persistStartedWorkout, setSetLogged, updateSet } from './workouts';
import type { SetInput, SetRow, WorkoutDetail } from './workouts';

export const SET_ADD = ['workout', 'set', 'add'] as const;
export const SET_UPDATE = ['workout', 'set', 'update'] as const;
export const SET_DELETE = ['workout', 'set', 'delete'] as const;
export const SET_LOG = ['workout', 'set', 'log'] as const;
// Старт тренировки из программы. Оптимистичный посев дерева делает экран (синхронно, до
// навигации) — здесь только серверная запись + реконсиляция; персист по mutationKey даёт
// доживание записи через перезапуск, как у логирования подходов.
export const WORKOUT_START = ['workout', 'start'] as const;

export type AddSetVars = { workoutId: string; weId: string; input: SetInput; id: string };
export type UpdateSetVars = { workoutId: string; id: string; input: SetInput };
export type DeleteSetVars = { workoutId: string; setId: string };
export type LogSetVars = { workoutId: string; id: string; logged: boolean; restSec: number | null };

const wkey = (workoutId: string) => ['workout', workoutId];

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
    mutationFn: (v: AddSetVars) => addSet(v.weId, v.input, v.id),
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
                    completed_at: new Date().toISOString(),
                    logged_at: null,
                  },
                ],
              }
            : we,
        ),
      }));
    },
    onSettled: (_d, _e, v: AddSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(SET_UPDATE, {
    mutationFn: (v: UpdateSetVars) => updateSet(v.id, v.input),
    onMutate: async (v: UpdateSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) => mapSet(w, v.id, (s) => ({ ...s, ...v.input }) as SetRow));
    },
    onSettled: (_d, _e, v: UpdateSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(SET_DELETE, {
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
    onSettled: (_d, _e, v: DeleteSetVars) => settle(v.workoutId),
  });

  qc.setMutationDefaults(WORKOUT_START, {
    mutationFn: (d: WorkoutDetail) => persistStartedWorkout(d),
    // оптимистику в ['workout', id] и ['workouts'] кладёт экран программы синхронно — здесь не
    // дублируем (onMutate из восстановленной мутации не вызовется; кэш и так персистится).
    onSettled: (_data, _err, d: WorkoutDetail) => {
      qc.invalidateQueries({ queryKey: wkey(d.id) });
      qc.invalidateQueries({ queryKey: ['workouts'] });
    },
  });

  qc.setMutationDefaults(SET_LOG, {
    mutationFn: (v: LogSetVars) => setSetLogged(v.id, v.logged, v.restSec),
    onMutate: async (v: LogSetVars) => {
      await cancel(v.workoutId);
      patch(v.workoutId, (w) =>
        mapSet(w, v.id, (s) => ({
          ...s,
          logged_at: v.logged ? new Date().toISOString() : null,
          rest_sec: v.logged ? v.restSec : null,
        })),
      );
    },
    onSettled: (_d, _e, v: LogSetVars) => settle(v.workoutId),
  });
}
