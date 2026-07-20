// Серверный гейт фич по роли (user_roles). ИИ — только full/admin: комьюнити-роль grip
// не может дёрнуть ИИ-функции даже напрямую (спрятанные табы — не защита), бюджет закрыт.
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type AppRole = 'grip' | 'full' | 'admin';

export async function getRole(admin: SupabaseClient, userId: string): Promise<AppRole | null> {
  const { data, error } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error(`roles: user_roles lookup failed for ${userId}: ${error.message}`);
    return null;
  }
  return data?.role === 'grip' || data?.role === 'full' || data?.role === 'admin'
    ? data.role
    : null;
}

export async function hasPrivateAccess(admin: SupabaseClient, userId: string): Promise<boolean> {
  const role = await getRole(admin, userId);
  return role === 'full' || role === 'admin';
}

// Сейчас AI является частью того же закрытого private-режима. Оставляем отдельное имя для
// call sites: если продуктовые права разойдутся, гейт можно будет разделить в одном месте.
export const hasAiAccess = hasPrivateAccess;
