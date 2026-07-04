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
