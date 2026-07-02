// Серверный гейт фич по роли (user_roles). ИИ — только full/admin: комьюнити-роль grip
// не может дёрнуть ИИ-функции даже напрямую (спрятанные табы — не защита), бюджет закрыт.
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function hasAiAccess(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  // сбой запроса ≠ роль grip: направление то же (deny), но в логах должно быть видно
  if (error) console.error(`roles: user_roles lookup failed for ${userId}: ${error.message}`);
  // нет строки → запрет по умолчанию (deny by default)
  return data?.role === 'full' || data?.role === 'admin';
}
