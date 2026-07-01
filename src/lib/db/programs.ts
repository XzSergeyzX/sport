import { supabase } from '@/lib/supabase';
import { fromKg, type WeightUnit } from '@/lib/use-unit';

import type { Exercise } from './exercises';
import { newId } from './ids';
import type { SetRow, WorkoutDetail, WorkoutExercise } from './workouts';

export type ProgramSet = {
  id: string;
  program_exercise_id: string;
  order_index: number;
  target_reps: number | null;
  target_duration_sec: number | null;
  target_weight: number | null;
  target_rpe: number | null;
  rest_sec: number | null;
  notes: string | null;
  meta: Record<string, unknown> | null; // сторона (side) и пр. per-set дескрипторы плана
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

/**
 * Настоящий кластер — суперсет/круг/EMOM/AMRAP и т.п., где упражнения делаются вместе
 * раунд-за-раундом. «single»-блок кластером НЕ является, даже если импорт ошибочно сложил в
 * него несколько самостоятельных упражнений — каждое идёт само по себе, без общей шапки.
 */
export function isClusterBlock(block: ProgramBlock | null | undefined): boolean {
  return !!block && block.type != null && block.type !== 'single';
}

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

/** Максимум программ на юзера — гигиена хранилища (SPEC §5, 📦-хотспот): без ручного лимита
 *  юзеры засыпят БД шаблонами. Пресеты-шаблоны (глобальные) под кап не попадают. */
export const MAX_USER_PROGRAMS = 3;

/**
 * Создать пустую программу вручную (без ИИ). Enforce кап на число программ юзера —
 * при достижении бросает 'program_cap' (UI показывает подсказку). Ветка «ручной конструктор»:
 * упражнения потом добавляются из каталога (addProgramExercise) → exercise_id всегда проставлен,
 * т.е. эти программы иммунны к null-дропу в buildWorkoutFromProgram (в отличие от ИИ-импорта).
 */
export async function createProgram(userId: string, title: string): Promise<string> {
  const { count, error: cErr } = await supabase
    .from('programs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (cErr) throw cErr;
  if ((count ?? 0) >= MAX_USER_PROGRAMS) throw new Error('program_cap');

  const { data, error } = await supabase
    .from('programs')
    .insert({ user_id: userId, title: title.trim().slice(0, 200) || title, source: 'manual' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Добавить упражнение из каталога в программу (ручной конструктор). blockId=null → standalone,
 *  иначе — внутрь кластер-блока (суперсет/EMOM/AMRAP). */
export async function addProgramExercise(
  programId: string,
  exerciseId: string,
  name: string,
  orderIndex: number,
  blockId: string | null = null,
): Promise<string> {
  const { data, error } = await supabase
    .from('program_exercises')
    .insert({
      program_id: programId,
      block_id: blockId,
      exercise_id: exerciseId,
      name: name.trim().slice(0, 200),
      order_index: orderIndex,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Создать кластер-блок (суперсет/EMOM/E2MOM/AMRAP) в программе — ручной конструктор. */
export async function createProgramBlock(
  programId: string,
  patch: {
    type: string;
    label?: string | null;
    rounds?: number | null;
    interval_sec?: number | null;
    duration_sec?: number | null;
    rest_sec?: number | null;
  },
  orderIndex: number,
): Promise<string> {
  const { data, error } = await supabase
    .from('program_blocks')
    .insert({ program_id: programId, order_index: orderIndex, ...patch })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Удалить блок (каскадом — его упражнения через FK on delete cascade). */
export async function deleteProgramBlock(id: string): Promise<void> {
  const { error } = await supabase.from('program_blocks').delete().eq('id', id);
  if (error) throw error;
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
    // пустой кластер-блок всё равно показываем (шапка) — в ручном конструкторе его только что
    // создали и заполняют; пустой «single»-блок пропускаем (нечего показывать)
    if (!exercises.length && !isClusterBlock(block)) continue;
    // настоящий кластер — одной группой; «single»-блок — каждое упражнение само по себе (без шапки)
    if (isClusterBlock(block)) groups.push({ block, exercises });
    else for (const ex of exercises) groups.push({ block: null, exercises: [ex] });
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

/** Переименовать программу. */
export async function updateProgram(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('programs')
    .update({ title: title.trim().slice(0, 200) })
    .eq('id', id);
  if (error) throw error;
}

/** Переименовать упражнение в программе (отображаемое имя, как в плане). */
export async function updateProgramExercise(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('program_exercises')
    .update({ name: name.trim().slice(0, 200) })
    .eq('id', id);
  if (error) throw error;
}

/** Удалить упражнение из программы (каскадом — его плановые подходы). */
export async function deleteProgramExercise(id: string): Promise<void> {
  const { error } = await supabase.from('program_exercises').delete().eq('id', id);
  if (error) throw error;
}

/** Переставить упражнения: упражнению idsInOrder[k] присваиваем order_index = orderValues[k].
 *  orderValues — существующие слоты группы (по возр.), idsInOrder — новый порядок id. */
export async function reorderProgramExercises(
  idsInOrder: string[],
  orderValues: number[],
): Promise<void> {
  await Promise.all(
    idsInOrder.map((id, k) =>
      supabase.from('program_exercises').update({ order_index: orderValues[k] }).eq('id', id),
    ),
  );
}

/** Плановый подход: добавить / изменить / удалить (редактирование программы). */
export async function addProgramSet(
  programExerciseId: string,
  orderIndex: number,
  id: string = newId(),
): Promise<void> {
  // id принимаем извне → оптимистичная строка в кэше и реальная вставка совпадают по id
  const { error } = await supabase
    .from('program_sets')
    .insert({ id, program_exercise_id: programExerciseId, order_index: orderIndex });
  if (error) throw error;
}

export async function updateProgramSet(
  id: string,
  patch: {
    target_reps?: number | null;
    target_weight?: number | null;
    target_duration_sec?: number | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await supabase.from('program_sets').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteProgramSet(id: string): Promise<void> {
  const { error } = await supabase.from('program_sets').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Сколько раундов делать в блоке.
 * EMOM/E2MOM: длительность ÷ интервал ÷ кол-во упражнений (EMOM16, 4 упр., 60с → 4).
 * Иначе — заданные rounds (3 кола → 3) или 1.
 */
export function blockRounds(block: ProgramBlock, exerciseCount: number): number {
  if (block.rounds && block.rounds > 0) return block.rounds;
  if (
    (block.type === 'emom' || block.type === 'e2mom') &&
    block.duration_sec &&
    block.interval_sec &&
    exerciseCount > 0
  ) {
    return Math.max(1, Math.floor(block.duration_sec / (block.interval_sec * exerciseCount)));
  }
  return 1;
}

/**
 * Собрать тренировку из программы ЛОКАЛЬНО, без сети: все id генерятся на клиенте, плановые
 * значения префиллятся (вес из канонических кг → в активную единицу). Возвращает полный
 * WorkoutDetail для оптимистичного посева в кэш ['workout', id] — старт работает оффлайн и
 * переживает перезапуск (SPEC §4). Серверная запись — отдельно, через persistStartedWorkout.
 * exercisesById — каталог упражнений (из кэша ['exercises-all']) для верной метрики/имени;
 * без него имя берётся из плана (display_name), метрика по умолчанию — повторы.
 */
export function buildWorkoutFromProgram(
  userId: string,
  detail: ProgramDetail,
  unit: WeightUnit,
  exercisesById?: Map<string, Exercise>,
): WorkoutDetail {
  const now = new Date().toISOString();
  const workoutId = newId();
  const wes: WorkoutExercise[] = [];

  for (const group of groupProgram(detail)) {
    const block = group.block;
    const isCluster = isClusterBlock(block);
    // суперсет: подходы заданы ЯВНО (каждый = круг, пирамида 12/10/8) → без умножения.
    // EMOM/E2MOM/rounds: у упражнения один per-round таргет → умножаем на круги.
    const repeat =
      isCluster && block!.type !== 'superset'
        ? blockRounds(block!, group.exercises.length)
        : 1;

    for (const pe of group.exercises) {
      if (!pe.exercise_id) continue; // без привязки к каталогу в тренировку не добавить
      const weId = newId();
      const sets: SetRow[] = [];
      const baseSets = pe.program_sets.length ? pe.program_sets : [null];
      for (let r = 0; r < repeat; r++) {
        for (const ps of baseSets) {
          const w = ps ? fromKg(ps.target_weight, unit) : null;
          sets.push({
            id: newId(),
            workout_exercise_id: weId,
            reps: ps ? ps.target_reps : null,
            duration_sec: ps ? ps.target_duration_sec : null,
            weight: w == null ? null : Math.round(w * 10) / 10,
            rest_sec: null,
            rpe: null,
            note: null,
            meta: ps ? ps.meta : null, // переносим сторону/дескрипторы плана в тренировку
            completed_at: now,
            logged_at: null, // префилл-план, ещё не сделан
          });
        }
      }
      wes.push({
        id: weId,
        workout_id: workoutId,
        exercise_id: pe.exercise_id,
        order_index: wes.length,
        done_at: null,
        block_key: isCluster ? block!.id : null,
        block_label: isCluster ? (block!.label ?? null) : null,
        block_rounds: isCluster ? repeat : null,
        block_type: isCluster ? (block!.type ?? null) : null,
        block_interval_sec: isCluster ? (block!.interval_sec ?? null) : null,
        display_name: pe.name,
        exercise: exercisesById?.get(pe.exercise_id) ?? null,
        sets,
      });
    }
  }

  return {
    id: workoutId,
    user_id: userId,
    started_at: now,
    ended_at: null,
    title: null,
    notes: null,
    workout_exercises: wes,
  };
}
