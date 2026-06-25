import { supabase } from '@/lib/supabase';

import type { Exercise } from './exercises';
import { newId } from './ids';

export type SetRow = {
  id: string;
  workout_exercise_id: string;
  reps: number | null;
  duration_sec: number | null;
  weight: number | null;
  rest_sec: number | null;
  rpe: number | null;
  note: string | null;
  meta: Record<string, unknown> | null;
  completed_at: string;
  logged_at: string | null;
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  exercise_id: string;
  order_index: number;
  done_at: string | null;
  block_key: string | null;
  block_label: string | null;
  block_rounds: number | null;
  block_type: string | null;
  block_interval_sec: number | null;
  display_name: string | null;
  exercise: Exercise | null;
  sets: SetRow[];
};

export type Workout = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  notes: string | null;
};

export type WorkoutDetail = Workout & { workout_exercises: WorkoutExercise[] };

/**
 * Настоящий кластер (суперсет/круг/EMOM) — а не «single»-блок самостоятельных упражнений,
 * которые импорт мог ошибочно сложить в один блок. «single» показываем отдельными карточками,
 * без общей шапки и без раунд-за-раундом схлопывания подходов.
 */
export function isClusteredWorkoutExercise(we: WorkoutExercise): boolean {
  return !!we.block_key && we.block_type != null && we.block_type !== 'single';
}

export type SetInput = {
  reps?: number | null;
  duration_sec?: number | null;
  weight?: number | null;
  rest_sec?: number | null;
  rpe?: number | null;
  meta?: Record<string, unknown> | null;
};

const DETAIL_SELECT = '*, workout_exercises(*, exercise:exercises(*), sets(*))';

/**
 * Собрать пустую тренировку ЛОКАЛЬНО (offline-first, SPEC §4): id генерится на клиенте, на выходе
 * готовый WorkoutDetail для оптимистичного посева в кэш. Серверная запись — через дефолт
 * WORKOUT_START (persistStartedWorkout), общий со стартом из программы.
 */
export function buildEmptyWorkout(userId: string): WorkoutDetail {
  return {
    id: newId(),
    user_id: userId,
    started_at: new Date().toISOString(),
    ended_at: null,
    title: null,
    notes: null,
    workout_exercises: [],
  };
}

/**
 * Записать на сервер уже собранную тренировку (workout + упражнения + плановые подходы), пакетно.
 * Идемпотентно (upsert по client-id) → безопасно доигрывается из оффлайн-очереди. Общий writer
 * для пустого старта (buildEmptyWorkout) и старта из программы (buildWorkoutFromProgram); зовётся
 * из mutationFn дефолта WORKOUT_START (см. workout-mutations.ts).
 */
export async function persistStartedWorkout(d: WorkoutDetail): Promise<void> {
  const { error: wErr } = await supabase
    .from('workouts')
    .upsert({ id: d.id, user_id: d.user_id, started_at: d.started_at });
  if (wErr) throw wErr;
  if (d.workout_exercises.length === 0) return;

  const weRows = d.workout_exercises.map((we) => ({
    id: we.id,
    workout_id: we.workout_id,
    exercise_id: we.exercise_id,
    order_index: we.order_index,
    display_name: we.display_name,
    block_key: we.block_key,
    block_label: we.block_label,
    block_rounds: we.block_rounds,
    block_type: we.block_type,
    block_interval_sec: we.block_interval_sec,
  }));
  const { error: weErr } = await supabase.from('workout_exercises').upsert(weRows);
  if (weErr) throw weErr;

  const setRows = d.workout_exercises.flatMap((we) =>
    we.sets.map((s) => ({
      id: s.id,
      workout_exercise_id: s.workout_exercise_id,
      weight: s.weight,
      reps: s.reps,
      duration_sec: s.duration_sec,
    })),
  );
  if (setRows.length) {
    const { error: sErr } = await supabase.from('sets').upsert(setRows);
    if (sErr) throw sErr;
  }
}

export type WorkoutImportResult = {
  workout_id: string;
  date: string;
  exercise_count: number;
  duration_min: number;
};

/** Импорт ПРОШЛОЙ тренировки из текста (постфактум) → сразу завершённая сессия. */
export async function importPastWorkout(text: string): Promise<WorkoutImportResult> {
  const { data, error } = await supabase.functions.invoke('workout-import', { body: { text } });
  if (error) {
    let code = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === 'function') {
      try {
        const parsed = JSON.parse(await ctx.text());
        code = parsed.error ?? parsed.detail ?? code;
      } catch {
        /* оставляем error.message */
      }
    }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return data as WorkoutImportResult;
}

export async function getWorkoutDetail(id: string): Promise<WorkoutDetail> {
  const { data, error } = await supabase.from('workouts').select(DETAIL_SELECT).eq('id', id).single();
  if (error) throw error;
  const detail = data as unknown as WorkoutDetail;
  detail.workout_exercises?.sort((a, b) => a.order_index - b.order_index);
  detail.workout_exercises?.forEach((we) =>
    we.sets?.sort((a, b) => a.completed_at.localeCompare(b.completed_at)),
  );
  return detail;
}

export async function listWorkouts(userId: string): Promise<WorkoutDetail[]> {
  const { data, error } = await supabase
    .from('workouts')
    .select(DETAIL_SELECT)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as unknown as WorkoutDetail[];
}

/**
 * Часто/недавно используемые упражнения — для быстрого доступа вверху пикера.
 * Берём последние ~25 тренировок, считаем частоту + порядок появления (recency),
 * сортируем: чаще → недавнее. RLS уже ограничивает выборку текущим юзером.
 */
export async function getRecentExercises(limit = 8): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('workouts')
    .select('started_at, workout_exercises(exercise:exercises(*))')
    .order('started_at', { ascending: false })
    .limit(25);
  if (error) throw error;

  const seen = new Map<string, { ex: Exercise; count: number; firstIdx: number }>();
  let idx = 0;
  const workouts = (data ?? []) as unknown as {
    workout_exercises?: { exercise: Exercise | null }[];
  }[];
  for (const w of workouts) {
    for (const we of w.workout_exercises ?? []) {
      const ex = we.exercise;
      if (!ex) continue;
      const cur = seen.get(ex.id);
      if (cur) cur.count += 1;
      else seen.set(ex.id, { ex, count: 1, firstIdx: idx });
      idx += 1;
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.firstIdx - b.firstIdx)
    .slice(0, limit)
    .map((v) => v.ex);
}

export async function addWorkoutExercise(
  workoutId: string,
  exerciseId: string,
  orderIndex: number,
  block?: {
    key: string;
    label: string | null;
    rounds: number | null;
    type: string | null;
    intervalSec: number | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from('workout_exercises')
    .upsert({
      id: newId(),
      workout_id: workoutId,
      exercise_id: exerciseId,
      order_index: orderIndex,
      block_key: block?.key ?? null,
      block_label: block?.label ?? null,
      block_rounds: block?.rounds ?? null,
      block_type: block?.type ?? null,
      block_interval_sec: block?.intervalSec ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function addSet(
  workoutExerciseId: string,
  input: SetInput,
  id: string = newId(),
): Promise<SetRow> {
  // id принимаем извне, чтобы оптимистичный подход в кэше и реальная вставка были одним id
  // (иначе правка оффлайн-подхода ушла бы в несуществующую строку). upsert → повтор безопасен.
  const { data, error } = await supabase
    .from('sets')
    .upsert({ id, workout_exercise_id: workoutExerciseId, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as SetRow;
}

export async function updateSet(id: string, input: SetInput): Promise<void> {
  const { error } = await supabase.from('sets').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteSet(id: string): Promise<void> {
  const { error } = await supabase.from('sets').delete().eq('id', id);
  if (error) throw error;
}

/** Убрать упражнение из тренировки целиком (подходы удалятся каскадом по FK). */
export async function deleteWorkoutExercise(id: string): Promise<void> {
  const { error } = await supabase.from('workout_exercises').delete().eq('id', id);
  if (error) throw error;
}

/** Отметить/снять «подход сделан». При отметке пишем время и отдых (разрыв с прошлым). */
export async function setSetLogged(
  id: string,
  logged: boolean,
  restSec: number | null,
): Promise<void> {
  const patch = logged
    ? { logged_at: new Date().toISOString(), rest_sec: restSec }
    : { logged_at: null, rest_sec: null };
  const { error } = await supabase.from('sets').update(patch).eq('id', id);
  if (error) throw error;
}

/** Переставить упражнения тренировки: idsInOrder[k] получает order_index = orderValues[k]. */
export async function reorderWorkoutExercises(
  idsInOrder: string[],
  orderValues: number[],
): Promise<void> {
  await Promise.all(
    idsInOrder.map((id, k) =>
      supabase.from('workout_exercises').update({ order_index: orderValues[k] }).eq('id', id),
    ),
  );
}

/** Завершить/возобновить упражнение (для сворачивания карточки). */
export async function setExerciseDone(workoutExerciseId: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('workout_exercises')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', workoutExerciseId);
  if (error) throw error;
}

/** Удалить тренировку целиком (каскадом — упражнения и подходы). Необратимо. */
export async function deleteWorkout(id: string): Promise<void> {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  if (error) throw error;
}

export async function finishWorkout(id: string): Promise<void> {
  // ставим время окончания только если ещё не завершена — при редактировании уже
  // завершённой тренировки «Завершити» не должно раздувать длительность (старт вчера → кінець сьогодні).
  const { error } = await supabase
    .from('workouts')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .is('ended_at', null);
  if (error) throw error;
}

export type WorkoutStats = {
  tonnage: number;
  sets: number;
  reps: number;
  holdSec: number;
  exercises: number;
  durationMin: number | null;
};

/** Метрики тренировки — считаем локально для мгновенной пост-тренировочной сводки. */
export function workoutStats(w: WorkoutDetail): WorkoutStats {
  let tonnage = 0;
  let sets = 0;
  let reps = 0;
  let holdSec = 0;
  let exercises = 0;
  for (const we of w.workout_exercises ?? []) {
    let anyDone = false;
    for (const s of we.sets ?? []) {
      if (!s.logged_at) continue; // невыполненные подходы не считаем
      anyDone = true;
      // «обидві» (обе руки на одном весе) → объём считаем ×2 (повт/тоннаж/удержание)
      const mult = (s.meta as { side?: string } | null)?.side === 'both' ? 2 : 1;
      sets += 1;
      reps += (s.reps ?? 0) * mult;
      holdSec += (s.duration_sec ?? 0) * mult;
      tonnage += (s.weight ?? 0) * (s.reps ?? 0) * mult;
    }
    if (anyDone) exercises += 1;
  }
  const durationMin = w.ended_at
    ? Math.max(0, Math.round((+new Date(w.ended_at) - +new Date(w.started_at)) / 60000))
    : null;
  return { tonnage, sets, reps, holdSec, exercises, durationMin };
}
