import { supabase } from '@/lib/supabase';

/**
 * Эспандер для словника «Сила хвата». Глобальные (is_global) — каталог брендов мира
 * (RGC = среднее по чарту); личные (owner_id) — свои, замеренные, показываются в приоритете.
 */
export type Gripper = {
  id: string;
  owner_id: string | null;
  name: string;
  brand: string | null;
  rgc: number | null;
  rgc_unit: 'kg' | 'lb';
  is_global: boolean;
  created_at: string;
};

export type GripperInput = {
  name: string;
  rgc: number | null;
  rgc_unit: 'kg' | 'lb';
};

const LB_PER_KG = 2.2046226218;

/** RGC в килограммах (для показа рядом, чарт в фунтах). */
export function rgcInKg(g: Gripper): number | null {
  if (g.rgc == null) return null;
  return g.rgc_unit === 'lb' ? g.rgc / LB_PER_KG : g.rgc;
}

/** Каталог для выбора: личные + глобальные (личные первыми, дальше по бренду и RGC). */
export async function listGripperCatalog(userId: string): Promise<Gripper[]> {
  const { data, error } = await supabase
    .from('grippers')
    .select('*')
    .or(`owner_id.eq.${userId},is_global.eq.true`);
  if (error) throw error;
  const list = (data ?? []) as Gripper[];
  return list.sort((a, b) => {
    if (a.is_global !== b.is_global) return a.is_global ? 1 : -1; // личные сверху
    const brand = (a.brand ?? '').localeCompare(b.brand ?? '');
    if (brand !== 0) return brand;
    return (a.rgc ?? 0) - (b.rgc ?? 0);
  });
}

/** Только свои эспандеры (для экрана управления). */
export async function listMyGrippers(userId: string): Promise<Gripper[]> {
  const { data, error } = await supabase
    .from('grippers')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Gripper[];
}

export async function addGripper(userId: string, input: GripperInput): Promise<Gripper> {
  const { data, error } = await supabase
    .from('grippers')
    .insert({
      owner_id: userId,
      name: input.name.trim().slice(0, 120),
      rgc: input.rgc,
      rgc_unit: input.rgc_unit,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Gripper;
}

export async function updateGripper(id: string, input: GripperInput): Promise<void> {
  const { error } = await supabase
    .from('grippers')
    .update({
      name: input.name.trim().slice(0, 120),
      rgc: input.rgc,
      rgc_unit: input.rgc_unit,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteGripper(id: string): Promise<void> {
  const { error } = await supabase.from('grippers').delete().eq('id', id);
  if (error) throw error;
}

/** Полное имя: «CoC #2» / «Standard Ti (pinned)» / своё имя без бренда. */
export function gripperName(g: Gripper): string {
  return g.brand ? `${g.brand} ${g.name}` : g.name;
}

/** Подпись для списков/выбора: «CoC #2 · 103 lb». */
export function gripperLabel(g: Gripper): string {
  const base = gripperName(g);
  if (g.rgc == null) return base;
  return `${base} · ${g.rgc} ${g.rgc_unit}`;
}
