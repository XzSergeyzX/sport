import { supabase } from '@/lib/supabase';
import { fromKg, type WeightUnit } from '@/lib/use-unit';

import { addSet, addWorkoutExercise, startWorkout } from './workouts';

export type ProgramSet = {
  id: string;
  program_exercise_id: string;
  order_index: number;
  target_reps: number | null;
  target_weight: number | null;
  target_rpe: number | null;
  rest_sec: number | null;
  notes: string | null;
};

export type ProgramExercise = {
  id: string;
  program_id: string;
  exercise_id: string | null;
  name: string;
  order_index: number;
  notes: string | null;
  program_sets: ProgramSet[];
};

export type Program = {
  id: string;
  user_id: string;
  title: string;
  source: string | null;
  notes: string | null;
  created_at: string;
};

export type ProgramDetail = Program & { program_exercises: ProgramExercise[] };

export type ImportResult = {
  program_id: string;
  exercise_count: number;
  cost: number;
  provider: string;
  model: string;
};

/** Распарсить текст расписания через ИИ-гейтвей и сохранить как программу. */
export async function importProgram(text: string): Promise<ImportResult> {
  const { data, error } = await supabase.functions.invoke('program-import', { body: { text } });
  if (error) {
    // тело ошибки функции лежит в error.context (это Response) — читаем код оттуда
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
  // функция может вернуть 200 с телом-ошибкой
  if (data?.error) throw new Error(data.error);
  return data as ImportResult;
}

export async function listPrograms(userId: string): Promise<Program[]> {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Program[];
}

export async function getProgramDetail(id: string): Promise<ProgramDetail> {
  const { data, error } = await supabase
    .from('programs')
    .select('*, program_exercises(*, program_sets(*))')
    .eq('id', id)
    .single();
  if (error) throw error;
  const detail = data as unknown as ProgramDetail;
  detail.program_exercises?.sort((a, b) => a.order_index - b.order_index);
  detail.program_exercises?.forEach((pe) =>
    pe.program_sets?.sort((a, b) => a.order_index - b.order_index),
  );
  return detail;
}

export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabase.from('programs').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Старт тренировки из программы: создаёт сессию и префиллит упражнения/подходы
 * плановыми значениями (вес из канонических кг → в активную единицу). Возвращает id тренировки.
 */
export async function startWorkoutFromProgram(
  userId: string,
  programId: string,
  unit: WeightUnit,
): Promise<string> {
  const detail = await getProgramDetail(programId);
  const workout = await startWorkout(userId);

  let order = 0;
  for (const pe of detail.program_exercises) {
    if (!pe.exercise_id) continue; // без привязки к каталогу в тренировку не добавить
    const weId = await addWorkoutExercise(workout.id, pe.exercise_id, order++);
    for (const ps of pe.program_sets) {
      const w = fromKg(ps.target_weight, unit);
      await addSet(weId, {
        weight: w == null ? null : Math.round(w * 10) / 10,
        reps: ps.target_reps,
        rpe: null, // RPE субъективно — заполняется по факту
        rest_sec: null, // отдых меряется автоматически в сессии
      });
    }
  }
  return workout.id;
}
