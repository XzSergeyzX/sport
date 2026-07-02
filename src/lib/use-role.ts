import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/supabase';

// Роль доступа (см. AGENTS.md): grip — комьюнити-режим (грипперы+лидерборд, без ИИ),
// full — вся апка, admin — full + модерация лидерборда. Источник истины — user_roles
// (сервер), клиент по роли только показывает/прячет UI: настоящий гейт ИИ — в Edge Functions.
export type AppRole = 'grip' | 'full' | 'admin';

export async function getMyRole(userId: string): Promise<AppRole> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  // нет строки — консервативно grip (сервер всё равно не пустит в ИИ)
  const r = data?.role;
  return r === 'full' || r === 'admin' ? r : 'grip';
}

/** Роль текущего юзера; undefined — ещё не загружена (первый запуск).
 *  Кэш персистится (offline-first), staleTime длинный — роль меняется редко. */
export function useRole(): AppRole | undefined {
  const { session } = useAuth();
  const userId = session?.user.id;
  const { data } = useQuery({
    queryKey: ['role', userId],
    queryFn: () => getMyRole(userId as string),
    enabled: !!userId,
    staleTime: 1000 * 60 * 30,
  });
  return data;
}
