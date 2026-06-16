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

function daysSince(startYmd: string, to: Date): number {
  const start = new Date(`${startYmd}T00:00:00`);
  const t = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((+t - +start) / 86_400_000);
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
