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
  block_id: string | null;
  exercise_id: string | null;
  name: string;
  order_index: number;
  notes: string | null;
  program_sets: ProgramSet[];
};

export type ProgramBlock = {
  id: string;
  program_id: string;
  order_index: number;
  type: string | null;
  label: string | null;
  rounds: number | null;
  interval_sec: number | null;
  duration_sec: number | null;
  rest_sec: number | null;
  note: string | null;
};

export type Program = {
  id: string;
  user_id: string;
  title: string;
  source: string | null;
  notes: string | null;
  created_at: string;
};

export type ProgramDetail = Program & {
  program_blocks: ProgramBlock[];
  program_exercises: ProgramExercise[];
};

/** Группа для отображения: блок (или null для несгруппированных) + его упражнения по порядку. */
export type ProgramGroup = { block: ProgramBlock | null; exercises: ProgramExercise[] };

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
    .select('*, program_blocks(*), program_exercises(*, program_sets(*))')
    .eq('id', id)
    .single();
  if (error) throw error;
  const detail = data as unknown as ProgramDetail;
  detail.program_blocks = detail.program_blocks ?? [];
  detail.program_exercises = detail.program_exercises ?? [];
  detail.program_exercises.forEach((pe) =>
    pe.program_sets?.sort((a, b) => a.order_index - b.order_index),
  );
  return detail;
}

/** Сгруппировать по блокам (в порядке блоков), несгруппированные (block_id=null) — отдельными группами. */
export function groupProgram(detail: ProgramDetail): ProgramGroup[] {
  const byOrder = (a: { order_index: number }, b: { order_index: number }) =>
    a.order_index - b.order_index;
  const groups: ProgramGroup[] = [];

  for (const block of [...detail.program_blocks].sort(byOrder)) {
    const exercises = detail.program_exercises
      .filter((pe) => pe.block_id === block.id)
      .sort(byOrder);
    if (exercises.length) groups.push({ block, exercises });
  }

  // legacy/несгруппированные упражнения — каждое как отдельная группа без блока
  const ungrouped = detail.program_exercises.filter((pe) => !pe.block_id).sort(byOrder);
  for (const ex of ungrouped) groups.push({ block: null, exercises: [ex] });

  return groups;
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
  for (const group of groupProgram(detail)) {
    const block = group.block;
    // кластер = не одиночный блок, либо в блоке больше одного упражнения
    const isCluster = !!block && (block.type !== 'single' || group.exercises.length > 1);
    const blockArg = isCluster
      ? { key: block!.id, label: block!.label ?? null, rounds: block!.rounds ?? null }
      : undefined;
    // круги (rounds) разворачиваем в подходы: 3 кола × 1 подход = 3 подхода
    const repeat = isCluster && block?.rounds ? block.rounds : 1;

    for (const pe of group.exercises) {
      if (!pe.exercise_id) continue; // без привязки к каталогу в тренировку не добавить
      const weId = await addWorkoutExercise(workout.id, pe.exercise_id, order++, blockArg);
      const baseSets = pe.program_sets.length ? pe.program_sets : [null];
      for (let r = 0; r < repeat; r++) {
        for (const ps of baseSets) {
          const w = ps ? fromKg(ps.target_weight, unit) : null;
          await addSet(weId, {
            weight: w == null ? null : Math.round(w * 10) / 10,
            reps: ps ? ps.target_reps : null,
            rpe: null, // RPE субъективно — заполняется по факту
            rest_sec: null, // отдых меряется автоматически в сессии
          });
        }
      }
    }
  }
  return workout.id;
}
