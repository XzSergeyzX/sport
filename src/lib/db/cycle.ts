import { localYmd } from '@/lib/dates';
import { supabase } from '@/lib/supabase';

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulation' | 'luteal';
export type CycleStatus = {
  periodId: string;
  day: number;
  phase: CyclePhase;
  startDate: string;
} | null;

/** Сдвинуть дату YYYY-MM-DD на delta дней. */
export function shiftYmd(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Фаза по дню цикла (типовая ~28-дневная модель). */
export function cyclePhase(day: number): CyclePhase {
  if (day <= 5) return 'menstrual';
  if (day <= 13) return 'follicular';
  if (day <= 16) return 'ovulation';
  return 'luteal';
}

/** Полных дней между двумя YYYY-MM-DD (положительно, если to позже from). Единственная
 *  реализация диффа дат по YMD (её же используют фаза/статус/средняя длина цикла). Round,
 *  а не floor: обе даты — локальная полночь, но день перевода часов длится 23/25 часов,
 *  и floor на нём терял бы сутки. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (+new Date(`${toYmd}T00:00:00`) - +new Date(`${fromYmd}T00:00:00`)) / 86_400_000,
  );
}

function daysSince(startYmd: string, to: Date): number {
  return daysBetween(startYmd, localYmd(to));
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Текущий статус цикла от последней отмеченной даты «день 1». */
export async function getCycleStatus(userId: string): Promise<CycleStatus> {
  const { data } = await supabase
    .from('cycle_periods')
    .select('id, start_date')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.start_date) return null;
  const day = daysSince(data.start_date, new Date()) + 1; // дата начала = день 1
  return { periodId: data.id as string, day, phase: cyclePhase(day), startDate: data.start_date };
}

/** Все отметки «день 1» (возр. порядок) — для расчёта фазы на исторические даты. */
export async function getPeriodStarts(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('cycle_periods')
    .select('start_date')
    .eq('user_id', userId)
    .order('start_date', { ascending: true });
  return (data ?? []).map((r) => r.start_date as string);
}

/**
 * Фаза цикла на дату ymd по списку отметок «день 1» (возр.).
 * Берём ближайшую отметку ≤ ymd; если день > 40 (нет свежей отметки) — фаза неизвестна (null),
 * чтобы не выдумывать «лютеїнова назавжди».
 */
export function phaseForDate(ymd: string, starts: string[]): CyclePhase | null {
  let start: string | null = null;
  for (const s of starts) {
    if (s <= ymd) start = s;
    else break;
  }
  if (!start) return null;
  const day = daysBetween(start, ymd) + 1;
  if (day < 1 || day > 40) return null;
  return cyclePhase(day);
}

/** Изменить дату начала цикла (коррекция). */
export async function updatePeriodStart(id: string, startYmd: string): Promise<void> {
  const { error } = await supabase
    .from('cycle_periods')
    .update({ start_date: startYmd })
    .eq('id', id);
  if (error) throw error;
}

/** Удалить отметку начала цикла. */
export async function deletePeriod(id: string): Promise<void> {
  const { error } = await supabase.from('cycle_periods').delete().eq('id', id);
  if (error) throw error;
}

/** Отметить начало цикла (день 1). По умолчанию — сегодня. */
export async function logPeriodStart(userId: string, date?: string): Promise<void> {
  const { error } = await supabase
    .from('cycle_periods')
    .upsert({ user_id: userId, start_date: date ?? todayYmd() }, { onConflict: 'user_id,start_date' });
  if (error) throw error;
}

export async function getTrackCycle(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profile')
    .select('track_cycle')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.track_cycle);
}

export async function setTrackCycle(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('profile')
    .update({ track_cycle: enabled })
    .eq('user_id', userId);
  if (error) throw error;
}
