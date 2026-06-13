import { supabase } from '@/lib/supabase';

export type Exercise = {
  id: string;
  name_en: string;
  name_uk: string;
  muscle_group: string | null;
  equipment: string | null;
  aliases: string[];
  is_global: boolean;
};

export function exerciseName(ex: Pick<Exercise, 'name_en' | 'name_uk'>, lang: string): string {
  return lang === 'uk' ? ex.name_uk : ex.name_en;
}

/** Поиск по каталогу: по name_en и name_uk (ilike). */
export async function searchExercises(q: string): Promise<Exercise[]> {
  // убираем символы, ломающие синтаксис or()/ilike в PostgREST
  const term = q.trim().replace(/[,()*%]/g, '');
  let query = supabase.from('exercises').select('*');
  if (term) {
    const like = `%${term}%`;
    query = query.or(`name_en.ilike.${like},name_uk.ilike.${like}`);
  }
  const { data, error } = await query.order('name_en').limit(40);
  if (error) throw error;
  return (data ?? []) as Exercise[];
}
