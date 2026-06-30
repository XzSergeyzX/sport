import { supabase } from '@/lib/supabase';

export type Gender = 'male' | 'female' | 'other' | 'na';

export async function getGender(userId: string): Promise<{ gender: Gender | null; self: string | null }> {
  const { data } = await supabase
    .from('profile')
    .select('gender, gender_self')
    .eq('user_id', userId)
    .maybeSingle();
  return { gender: (data?.gender ?? null) as Gender | null, self: data?.gender_self ?? null };
}

export async function setGender(userId: string, gender: Gender, self?: string | null): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ gender, gender_self: gender === 'other' ? (self?.trim() || null) : null })
    .eq('user_id', userId);
  if (error) throw error;
}

/** Вес тела (кг, канонически) — нужен тоннажу весо-телесных упражнений. NULL = не задан. */
export async function getBodyweight(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from('profile')
    .select('bodyweight')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.bodyweight ?? null;
}

export async function setBodyweight(userId: string, kg: number | null): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ bodyweight: kg == null || Number.isNaN(kg) ? null : kg })
    .eq('user_id', userId);
  if (error) throw error;
}

/** Ключ выбранного пресета-аватарки (см. src/lib/avatars.ts). NULL = инициалы. */
export async function getAvatar(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profile')
    .select('avatar')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.avatar ?? null;
}

export async function setAvatar(userId: string, key: string | null): Promise<void> {
  const { error } = await supabase.from('profile').update({ avatar: key }).eq('user_id', userId);
  if (error) throw error;
}
