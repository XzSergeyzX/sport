import { supabase } from '@/lib/supabase';

export type Gender = 'male' | 'female' | 'other' | 'na';

/** Безвозвратно удалить аккаунт (Play Store §удаление). RPC удаляет строго auth.uid() из
 *  auth.users → каскад по всем пользовательским данным. После — вызвать signOut. */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
}

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

/** Экран «Здоров'я» осмыслен только при подключённой OURA или трекинге цикла — иначе таб
 *  прячем (фидбек: у Сергея он пустой, нужен только Маше). */
export async function getHealthRelevant(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profile')
    .select('oura_connected, track_cycle')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data?.oura_connected || !!data?.track_cycle;
}

/** Тумблер таба «Лідерборд»: комьюнити-борд нужен не всем (Маше — нет), выключенный
 *  прячет таб целиком. UI-преференция, не защита: RLS борда не меняется. Дефолт — показывать. */
export async function getShowLeaderboard(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profile')
    .select('show_leaderboard')
    .eq('user_id', userId)
    .maybeSingle();
  // ошибку НЕ глотаем: молчаливый дефолт true перезаписал бы в persisted-кэше
  // осознанно выключенный тумблер (спрятанный таб «всплывал» бы при сбое сети)
  if (error) throw error;
  return data?.show_leaderboard ?? true;
}

export async function setShowLeaderboard(userId: string, show: boolean): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ show_leaderboard: show })
    .eq('user_id', userId);
  if (error) throw error;
}

/** Имя/никнейм: показывается на лидерборде и в persona коуча. NULL = «Athlete» на борде. */
export async function getDisplayName(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profile')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.display_name ?? null;
}

export async function setDisplayName(userId: string, name: string | null): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ display_name: name?.trim().slice(0, 40) || null })
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
