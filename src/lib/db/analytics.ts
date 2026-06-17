import { supabase } from '@/lib/supabase';

import type { Cluster } from './exercises';

// Лёгкая плоская выборка всех отмеченных подходов (по всей истории) — только поля для аналитики.
// RLS ограничивает текущим пользователем. Тяжёлую вложенную detail-выборку не используем.
export type LoggedSet = {
  weight: number | null;
  reps: number | null;
  duration_sec: number | null;
  rpe: number | null;
  meta: Record<string, unknown> | null;
  workout_exercises: {
    exercise_id: string;
    display_name: string | null;
    exercises: { name_en: string; name_uk: string; cluster: Cluster | null } | null;
    workouts: { id: string; started_at: string; ended_at: string | null } | null;
  } | null;
};

const SELECT =
  'weight, reps, duration_sec, rpe, meta, workout_exercises!inner(exercise_id, display_name, exercises(name_en, name_uk, cluster), workouts!inner(id, started_at, ended_at))';

/** Все залогированные подходы пользователя (с пагинацией — не упираемся в лимит строк). */
export async function getLoggedSets(): Promise<LoggedSet[]> {
  const page = 1000;
  const out: LoggedSet[] = [];
  for (let from = 0; from < 100000; from += page) {
    const { data, error } = await supabase
      .from('sets')
      .select(SELECT)
      .not('logged_at', 'is', null)
      .order('logged_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as LoggedSet[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
