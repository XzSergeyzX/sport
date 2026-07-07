import { supabase } from '@/lib/supabase';

import type { Cluster } from './exercises';

// Аналитика считается в SQL (RPC get_analytics_summary, миграция 20260704100000) — клиент
// получает компактную сводку вместо полной истории сетов. Раньше сюда качалась вся история
// (пагинация по 1000) и оседала в персисте кэша (AsyncStorage, лимит ~6МБ Android).
// Все веса — канонически в кг; конверсию в единицу пользователя делает UI.

export type AnalyticsWorkout = {
  id: string;
  started_at: string;
  ended_at: string | null;
  set_count: number;
  avg_rpe: number | null;
  tonnage: number; // кг; «чистые» силовые подходы, с весом тела для bodyweight_load
};

export type RepRecordRow = {
  exercise_id: string | null;
  name_en: string | null;
  name_uk: string | null;
  display_name: string | null;
  cluster: Cluster | null;
  weight: number;
  reps: number;
  one_rm: number; // оценка по О'Коннору (reps<=1 → сам вес)
  date: string;
  cheat: boolean;
};

export type TimeRecordRow = {
  exercise_id: string | null;
  name_en: string | null;
  name_uk: string | null;
  display_name: string | null;
  cluster: Cluster | null;
  sec: number;
  weight: number | null;
  date: string;
  cheat: boolean;
};

export type GripRecordRow = {
  set_type: string;
  gripper_name: string | null;
  rgc_kg: number | null;
  est_kg: number | null;
  reps: number;
  date: string;
};

export type AnalyticsSummary = {
  workouts: AnalyticsWorkout[];
  rep_records: RepRecordRow[]; // топ-5 на упражнение, отсортированы по 1ПМ внутри упражнения
  time_records: TimeRecordRow[]; // топ-5 на упражнение: вес desc, сек desc
  grip_records: GripRecordRow[]; // топ-3 на вид установки, отсортированы по оценке
};

/**
 * Первая строка на ключ = топ-1. Контракт сортировки живёт в SQL (миграция 20260704110000):
 * rep/time_records отсортированы (exercise_id, rn), grip_records — (set_type, rn), где rn=1 —
 * лучший результат. Меняешь ORDER BY в RPC — этот помощник и его потребители (Головна;
 * та же логика в тулзе get_records коуча) начнут отдавать не-топ строки.
 */
export function topPerKey<T>(rows: T[], key: (r: T) => string | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const k = key(r) ?? '';
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Сводка аналитики за всю историю (агрегаты по тренировкам + готовые топы рекордов). */
export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const { data, error } = await supabase.rpc('get_analytics_summary');
  if (error) throw error;
  const d = (data ?? {}) as Partial<AnalyticsSummary>;
  return {
    workouts: d.workouts ?? [],
    rep_records: d.rep_records ?? [],
    time_records: d.time_records ?? [],
    grip_records: d.grip_records ?? [],
  };
}
