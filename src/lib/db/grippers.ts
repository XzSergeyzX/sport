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

/** RGC в выбранной единице (для предзаполнения формы из каталога метрически). */
export function rgcInUnit(g: Gripper, unit: 'kg' | 'lb'): number | null {
  const kg = rgcInKg(g);
  if (kg == null) return null;
  return unit === 'lb' ? kg * LB_PER_KG : kg;
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

/** Только свои эспандеры (для экрана управления). Сортировка: по RGC в кг ↑, затем по имени
 *  (чтобы список читался по силе, а не по хронологии добавления). Без RGC — в конец. */
export async function listMyGrippers(userId: string): Promise<Gripper[]> {
  const { data, error } = await supabase
    .from('grippers')
    .select('*')
    .eq('owner_id', userId);
  if (error) throw error;
  return ((data ?? []) as Gripper[]).sort((a, b) => {
    const ka = rgcInKg(a) ?? Infinity;
    const kb = rgcInKg(b) ?? Infinity;
    if (ka !== kb) return ka - kb;
    return gripperName(a).localeCompare(gripperName(b));
  });
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

/** Подпись для списков/выбора. Первичная единица — выбранная в приложении (по умолч. кг),
 *  вторая в скобках: «CoC #3 · 67 kg (148 lb)». RGC хранится как замерили (kg или lb) —
 *  показываем нормализованно, чтобы метрический юзер видел кг даже у lb-замеренных. */
export function gripperLabel(g: Gripper, unit: 'kg' | 'lb' = 'kg'): string {
  const base = gripperName(g);
  if (g.rgc == null) return base;
  const kg = rgcInKg(g) as number;
  const lb = kg * LB_PER_KG;
  const primary = unit === 'kg' ? `${Math.round(kg)} kg` : `${Math.round(lb)} lb`;
  const secondary = unit === 'kg' ? `${Math.round(lb)} lb` : `${Math.round(kg)} kg`;
  return `${base} · ${primary} (${secondary})`;
}
