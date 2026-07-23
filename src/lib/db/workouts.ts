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

export class ActiveWorkoutExistsError extends Error {
  constructor(public readonly activeWorkoutId: string) {
    super('active_workout_exists');
    this.name = 'ActiveWorkoutExistsError';
  }
}

export function isActiveWorkoutExistsError(error: unknown): error is ActiveWorkoutExistsError {
  return error instanceof ActiveWorkoutExistsError;
}

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
  if (wErr) {
    if (wErr.code === '23505') {
      const { data: active } = await supabase
        .from('workouts')
        .select('id')
        .eq('user_id', d.user_id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active?.id && active.id !== d.id) {
        throw new ActiveWorkoutExistsError(active.id as string);
      }
    }
    throw wErr;
  }
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
      meta: s.meta ?? null, // сторона (side) из плана программы должна дожить до сервера
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

/** Строка сводки для списка тренировок: агрегаты посчитаны в SQL-вью workout_summaries —
 *  без вложенных подходов, поэтому можно тянуть все тренировки без обрезки. */
export type WorkoutSummary = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  notes: string | null;
  exercise_count: number;
  set_count: number;
  rep_count: number;
  hold_sec: number;
  tonnage: number;
};

/** Единый selector активной тренировки для всех точек старта. Список отсортирован newest-first,
 *  поэтому при старых дублях возвращаем самую свежую и не создаём ещё одну. */
export function findActiveWorkoutSummary(
  workouts: readonly WorkoutSummary[] | null | undefined,
): WorkoutSummary | undefined {
  return workouts?.find((workout) => workout.ended_at == null);
}

/** Список тренировок для главного экрана — лёгкие сводки из вью (RLS через security_invoker).
 *  Без limit: строка крошечная, показываем всю историю; нумерация считается от полного списка. */
export async function listWorkoutSummaries(userId: string): Promise<WorkoutSummary[]> {
  const { data, error } = await supabase
    .from('workout_summaries')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkoutSummary[];
}

/** Свести локальный WorkoutDetail к строке сводки — для оптимистичного посева в кэш списка при
 *  старте тренировки (свежая тренировка ещё без logged-подходов → агрегаты нулевые, это верно). */
export function summarizeWorkout(w: WorkoutDetail): WorkoutSummary {
  const s = workoutStats(w);
  return {
    id: w.id,
    user_id: w.user_id,
    started_at: w.started_at,
    ended_at: w.ended_at,
    title: w.title,
    notes: w.notes,
    exercise_count: s.exercises,
    set_count: s.sets,
    rep_count: s.reps,
    hold_sec: s.holdSec,
    tonnage: s.tonnage,
  };
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
  id: string = newId(),
  block?: {
    key: string;
    label: string | null;
    rounds: number | null;
    type: string | null;
    intervalSec: number | null;
  },
): Promise<string> {
  // id принимаем извне (как addSet): оптимистичная карточка в кэше и реальная вставка — один id,
  // upsert → доигрывание из оффлайн-очереди идемпотентно.
  const { data, error } = await supabase
    .from('workout_exercises')
    .upsert({
      id,
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
  completedAt?: string,
): Promise<SetRow> {
  // id принимаем извне, чтобы оптимистичный подход в кэше и реальная вставка были одним id
  // (иначе правка оффлайн-подхода ушла бы в несуществующую строку). upsert → повтор безопасен.
  // completedAt — время ТАПА, не исполнения: оффлайн-подход, досинканный через сутки, иначе
  // получил бы серверный now() и перемешал порядок сетов (сортировка по completed_at).
  const { data, error } = await supabase
    .from('sets')
    .upsert({
      id,
      workout_exercise_id: workoutExerciseId,
      ...input,
      ...(completedAt ? { completed_at: completedAt } : {}),
    })
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

/** Отметить/снять «подход сделан». При отметке пишем время и отдых (разрыв с прошлым).
 *  at — время ТАПА (передаёт экран): для оффлайн-очереди момент исполнения ≠ момент действия. */
export async function setSetLogged(
  id: string,
  logged: boolean,
  restSec: number | null,
  at: string,
): Promise<void> {
  const patch = logged ? { logged_at: at, rest_sec: restSec } : { logged_at: null, rest_sec: null };
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

/** Завершить/возобновить упражнение (для сворачивания карточки).
 *  at — время ТАПА (передаёт экран), а не исполнения из оффлайн-очереди. */
export async function setExerciseDone(
  workoutExerciseId: string,
  done: boolean,
  at: string,
): Promise<void> {
  const { error } = await supabase
    .from('workout_exercises')
    .update({ done_at: done ? at : null })
    .eq('id', workoutExerciseId);
  if (error) throw error;
}

/** Удалить тренировку целиком (каскадом — упражнения и подходы). Необратимо. */
export async function deleteWorkout(id: string): Promise<void> {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  if (error) throw error;
}

export async function finishWorkout(id: string, endedAt: string): Promise<void> {
  // ставим время окончания только если ещё не завершена — при редактировании уже
  // завершённой тренировки «Завершити» не должно раздувать длительность (старт вчера → кінець сьогодні).
  // endedAt — время ТАПА: тренировка, завершённая оффлайн и досинканная утром, иначе
  // получила бы ended_at момента реконнекта → длительность в 14 часов.
  const { error } = await supabase
    .from('workouts')
    .update({ ended_at: endedAt })
    .eq('id', id)
    .is('ended_at', null);
  if (error) throw error;
}

export function rescheduledWorkoutTimes(
  startedAt: string,
  endedAt: string | null,
  nextStartedAt: string,
): { started_at: string; ended_at: string | null } {
  const previousStartMs = new Date(startedAt).getTime();
  const nextStartMs = new Date(nextStartedAt).getTime();
  if (!Number.isFinite(previousStartMs) || !Number.isFinite(nextStartMs)) {
    throw new Error('invalid_workout_date');
  }
  const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - previousStartMs) : null;
  return {
    started_at: new Date(nextStartMs).toISOString(),
    ended_at: durationMs == null ? null : new Date(nextStartMs + durationMs).toISOString(),
  };
}

/** Перенести дату/время тренировки, сохранив её длительность. Повтор идемпотентен: целевой
 * started_at хранится в vars durable-мутации, а актуальная длительность читается с сервера. */
export async function updateWorkoutSchedule(id: string, nextStartedAt: string): Promise<void> {
  const { data, error: readError } = await supabase
    .from('workouts')
    .select('started_at, ended_at')
    .eq('id', id)
    .single();
  if (readError) throw readError;
  if (!data.ended_at) throw new Error('completed_workout_required');

  const next = rescheduledWorkoutTimes(data.started_at, data.ended_at, nextStartedAt);
  const { data: updated, error } = await supabase
    .from('workouts')
    .update(next)
    .eq('id', id)
    .eq('started_at', data.started_at)
    .eq('ended_at', data.ended_at)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error('workout_schedule_conflict');
}

export type WorkoutStats = {
  tonnage: number;
  sets: number;
  reps: number;
  holdSec: number;
  exercises: number;
  durationMin: number | null;
};

/** Метрики тренировки — считаем локально для мгновенной пост-тренировочной сводки (offline-first).
 *  bodyweightKg: вес тела (кг) для весо-телесных упражнений; 0 = не учитывать (совпадает со старым).
 *  Тоннаж — клиентская копия канонической SQL-формулы public.set_tonnage()
 *  (migrations/20260708100000_single_source_tonnage.sql; её используют вью workout_summaries
 *  и RPC analytics_summary_for). Меняешь правило тоннажа — меняй В ОБОИХ местах. */
export function workoutStats(w: WorkoutDetail, bodyweightKg = 0): WorkoutStats {
  let tonnage = 0;
  let sets = 0;
  let reps = 0;
  let holdSec = 0;
  let exercises = 0;
  for (const we of w.workout_exercises ?? []) {
    // нагрузка/повтор для весо-телесных = доп.вес + вес тела (1:1 с SQL-вью workout_summaries)
    const bw = we.exercise?.bodyweight_load ? bodyweightKg : 0;
    let anyDone = false;
    for (const s of we.sets ?? []) {
      if (!s.logged_at) continue; // невыполненные подходы не считаем
      anyDone = true;
      // «обидві» (обе руки на одном весе) → объём считаем ×2 (повт/тоннаж/удержание)
      const mult = (s.meta as { side?: string } | null)?.side === 'both' ? 2 : 1;
      sets += 1;
      reps += (s.reps ?? 0) * mult;
      holdSec += (s.duration_sec ?? 0) * mult;
      tonnage += ((s.weight ?? 0) + bw) * (s.reps ?? 0) * mult;
    }
    if (anyDone) exercises += 1;
  }
  const durationMin = w.ended_at
    ? Math.max(0, Math.round((+new Date(w.ended_at) - +new Date(w.started_at)) / 60000))
    : null;
  return { tonnage, sets, reps, holdSec, exercises, durationMin };
}
