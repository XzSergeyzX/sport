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
