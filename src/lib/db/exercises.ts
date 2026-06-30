import { supabase } from '@/lib/supabase';

export type Cluster = 'upper' | 'lower' | 'full' | 'core';
export type Category =
  | 'general'
  | 'weightlifting'
  | 'gymnastics'
  | 'crossfit'
  | 'armwrestling'
  | 'kettlebell'
  | 'grip';

/**
 * Дисципліни-словники: специфічні категорії, які користувач вмикає в Акаунті.
 * 'general' — це база, видно всім завжди, тому в дисципліни не входить.
 */
export type Discipline = Exclude<Category, 'general'>;
export const DISCIPLINES: Discipline[] = [
  'weightlifting',
  'gymnastics',
  'crossfit',
  'armwrestling',
  'kettlebell',
  'grip',
];

/** Чем меряется упражнение: повторами ('reps') или временем удержания в секундах ('time'). */
export type Metric = 'reps' | 'time';

/** Порядок кластеров в пикере (сверху вниз). */
export const CLUSTER_ORDER: Cluster[] = ['upper', 'lower', 'full', 'core'];

export type Exercise = {
  id: string;
  name_en: string;
  name_uk: string;
  muscle_group: string | null;
  equipment: string | null;
  aliases: string[];
  cluster: Cluster | null;
  category: Category | null;
  metric: Metric;
  is_base: boolean;
  log_kind: string | null; // null=обычная форма, 'gripper'=поля эспандера
  is_global: boolean;
  unilateral: boolean; // одностороннее (есть выбор стороны ліва/права/обидві)
  bodyweight_load: boolean; // «честное» весо-телесное (подтягивания/брусья/пистолет): нагрузка = вес тела + доп.вес
};

// «есть сторона»: явный флаг unilateral, иначе эвристика (хват / one-arm / wrist / однією рукою…)
const SIDE_RE =
  /one[-\s]?arm|single[-\s]?(arm|leg)|one[-\s]?leg|однією рук|одною рук|одной рук|однорук|на одній (руці|нозі)|per[-\s]?side|each[-\s]?side|wrist|кист/i;
export function exerciseSided(
  ex?: {
    name_en?: string;
    name_uk?: string;
    category?: string | null;
    log_kind?: string | null;
    unilateral?: boolean | null;
  } | null,
  displayName?: string | null,
): boolean {
  if (ex?.unilateral != null) return ex.unilateral; // ground truth из каталога
  if (ex?.log_kind === 'gripper' || ex?.category === 'grip') return true;
  return SIDE_RE.test(`${ex?.name_en ?? ''} ${ex?.name_uk ?? ''} ${displayName ?? ''}`);
}

export function exerciseName(ex: Pick<Exercise, 'name_en' | 'name_uk'>, lang: string): string {
  return lang === 'uk' ? ex.name_uk : ex.name_en;
}

/** i18n-ключ подписи кластера/категории (см. locales → clusters.* / categories.*). */
export function clusterKey(c: Cluster | null): string {
  return c ? `clusters.${c}` : 'clusters.other';
}
export function categoryKey(c: Category | null): string {
  return c ? `categories.${c}` : 'categories.other';
}

export type ClusterGroup = { cluster: Cluster | null; items: Exercise[] };

/** Группирует список по кластеру в фиксированном порядке (без таксономии — в конец). */
export function groupByCluster(list: Exercise[]): ClusterGroup[] {
  const groups: ClusterGroup[] = [];
  const index = new Map<Cluster | null, ClusterGroup>();
  const ensure = (cluster: Cluster | null): ClusterGroup => {
    let g = index.get(cluster);
    if (!g) {
      g = { cluster, items: [] };
      index.set(cluster, g);
    }
    return g;
  };
  for (const c of CLUSTER_ORDER) groups.push(ensure(c));
  const other = ensure(null);
  for (const ex of list) ensure(ex.cluster).items.push(ex);
  return [...groups, other].filter((g) => g.items.length > 0);
}

/** Весь доступный каталог (глобальные + свои). Кэшируется react-query — каталог небольшой. */
export async function listExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('*').order('name_en');
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

// ВРЕМЕННО (день-41): гейтинг каталога по дисциплинам выключен. Каталог пока
// крошечный (по сути армрестлінг + сила хвата + база), поэтому скрывать спец-вправи
// за дисциплинами — лишнее трение: новый юзер не видит натяжку, пока не угадает поиск.
// Показываем весь каталог всем. Вернуть в `true`, когда дисциплин-вправ станет много
// (тогда же — вход для выбора дисциплин в онбординге/пикере, не на профиле).
const CATALOG_DISCIPLINE_GATING = false;

/**
 * Видно ли упражнение в режиме просмотра пикера: своё (не глобальное) — всегда;
 * при включённом гейтинге: база — всем, специфика — только при включённой дисциплине.
 * Поиск этот фильтр игнорирует.
 */
export function isVisible(ex: Exercise, disciplines: string[]): boolean {
  if (!ex.is_global) return true;
  if (!CATALOG_DISCIPLINE_GATING) return true;
  if (ex.is_base) return true;
  return ex.category != null && disciplines.includes(ex.category);
}

/** Дисциплина упражнения, если её стоит предложить включить (специфика не из базы). */
export function disciplineToEnable(ex: Exercise, disciplines: string[]): Discipline | null {
  if (ex.is_base || !ex.is_global || !ex.category || ex.category === 'general') return null;
  if (disciplines.includes(ex.category)) return null;
  return ex.category as Discipline;
}

/** Включённые пользователем дисциплины-словники (profile.disciplines). */
export async function getDisciplines(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('profile')
    .select('disciplines')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.disciplines as string[] | null) ?? [];
}

export async function setDisciplines(userId: string, list: string[]): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ disciplines: list })
    .eq('user_id', userId);
  if (error) throw error;
}

/** Добавить дисциплину к включённым (если ещё нет). Возвращает обновлённый список. */
export async function enableDiscipline(userId: string, d: Discipline): Promise<string[]> {
  const cur = await getDisciplines(userId);
  if (cur.includes(d)) return cur;
  const next = [...cur, d];
  await setDisciplines(userId, next);
  return next;
}

/** Совпадение по названию (en/uk) и алиасам — подстрокой, регистронезависимо. */
export function matchExercise(ex: Exercise, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  if (ex.name_en.toLowerCase().includes(t)) return true;
  if (ex.name_uk.toLowerCase().includes(t)) return true;
  return ex.aliases.some((a) => a.toLowerCase().includes(t));
}

/** Поиск по каталогу (server-side, по name_en/name_uk) — оставлен для обратной совместимости. */
export async function searchExercises(q: string): Promise<Exercise[]> {
  const all = await listExercises();
  return all.filter((ex) => matchExercise(ex, q));
}

export const CATEGORY_ORDER: Category[] = [
  'general',
  'weightlifting',
  'gymnastics',
  'crossfit',
  'armwrestling',
  'kettlebell',
  'grip',
];

export type ExerciseEdit = {
  name_en: string;
  name_uk: string;
  cluster: Cluster | null;
  category: Category | null;
  metric: Metric;
};

/** Вид установки эспандера (для словника «Сила хвата»). */
export type GripSetType = 'tns' | 'card' | 'block_38' | 'block_20' | 'deep';
export const GRIP_SET_TYPES: GripSetType[] = ['tns', 'card', 'block_38', 'block_20', 'deep'];

/** Сторона выполнения подхода (для односторонних упражнений). */
export type SetSide = 'left' | 'right' | 'both';
export const SET_SIDES: SetSide[] = ['left', 'right', 'both'];

/** meta-поля подхода (хранятся в sets.meta): эспандер + читинг/сторона — для любых упражнений. */
export type GripMeta = {
  gripper_id?: string;
  set_type?: GripSetType;
  cheat?: boolean;
  side?: SetSide;
};

/** Свои (приватные) упражнения — для экрана управления. */
export async function listMyExercises(userId: string): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('owner_id', userId)
    .order('name_uk');
  if (error) throw error;
  return (data ?? []) as Exercise[];
}

/** Переименовать / задать таксономию своему упражнению (RLS пускает только владельца). */
export async function updateExercise(id: string, patch: ExerciseEdit): Promise<void> {
  const { error } = await supabase
    .from('exercises')
    .update({
      name_en: patch.name_en.trim().slice(0, 200),
      name_uk: patch.name_uk.trim().slice(0, 200),
      cluster: patch.cluster,
      category: patch.category,
      metric: patch.metric,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Удалить своё упражнение. Бросит ошибку, если оно используется в тренировках/программах (FK). */
export async function deleteExercise(id: string): Promise<void> {
  const { error } = await supabase.from('exercises').delete().eq('id', id);
  if (error) throw error;
}

/** Сколько раз упражнение используется — в тренировках и программах (для «заменить или удалить»). */
export async function countExerciseUsage(id: string): Promise<{ workouts: number; programs: number }> {
  const [w, p] = await Promise.all([
    supabase.from('workout_exercises').select('id', { count: 'exact', head: true }).eq('exercise_id', id),
    supabase.from('program_exercises').select('id', { count: 'exact', head: true }).eq('exercise_id', id),
  ]);
  return { workouts: w.count ?? 0, programs: p.count ?? 0 };
}

/**
 * Заменить упражнение `oldId` на `newId` во ВСЕХ тренировках и программах, затем удалить старое.
 * Подходы/настройки сохраняются (перецепляется только ссылка exercise_id). Так юзер может убрать
 * своё упражнение, даже если оно уже где-то используется, не теряя историю.
 */
export async function replaceExercise(oldId: string, newId: string): Promise<void> {
  const we = await supabase.from('workout_exercises').update({ exercise_id: newId }).eq('exercise_id', oldId);
  if (we.error) throw we.error;
  const pe = await supabase.from('program_exercises').update({ exercise_id: newId }).eq('exercise_id', oldId);
  if (pe.error) throw pe.error;
  const del = await supabase.from('exercises').delete().eq('id', oldId);
  if (del.error) throw del.error;
}

/**
 * Создать своё (приватное) упражнение. RLS делает его видимым только владельцу;
 * дневной лимит на спам — триггер enforce_exercise_daily_cap (код ошибки 'exercise_daily_cap').
 */
export async function createCustomExercise(userId: string, name: string): Promise<Exercise> {
  const trimmed = name.trim().slice(0, 200);
  // авто-капитализация первой буквы (пользователь ввёл с маленькой)
  const clean = trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      owner_id: userId,
      name_en: clean,
      name_uk: clean,
      is_global: false,
      unilateral: exerciseSided({ name_en: clean, name_uk: clean }),
    })
    .select('*')
    .single();
  if (error) {
    if (error.message.includes('exercise_daily_cap')) throw new Error('exercise_daily_cap');
    throw error;
  }
  return data as Exercise;
}
