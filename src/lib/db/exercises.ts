import { supabase } from '@/lib/supabase';

export type Cluster = 'upper' | 'lower' | 'full' | 'core';
export type Category =
  | 'general'
  | 'weightlifting'
  | 'gymnastics'
  | 'crossfit'
  | 'armwrestling'
  | 'kettlebell';

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
  is_global: boolean;
};

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
