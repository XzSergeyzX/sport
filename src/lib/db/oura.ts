import { supabase } from '@/lib/supabase';

export type OuraRaw = {
  sleepDetail?: {
    average_breath?: number;
    total_sleep_duration?: number;
    efficiency?: number;
  } | null;
  activity?: { steps?: number; score?: number; active_calories?: number } | null;
} | null;

export type HealthSnapshot = {
  date: string;
  readiness: number | null;
  sleep_score: number | null;
  hrv: number | null;
  rhr: number | null;
  temp: number | null;
  cycle_day: number | null;
  cycle_phase: string | null;
  raw: OuraRaw;
};

/** Сохранить OURA Personal Access Token (через Edge Function, токен на сервере). */
export async function connectOura(token: string): Promise<void> {
  const { error } = await supabase.functions.invoke('oura-connect', { body: { token } });
  if (error) throw error;
}

/** Подтянуть свежие данные OURA в health_snapshots (через Edge Function). */
export async function syncOura(): Promise<void> {
  const { error } = await supabase.functions.invoke('oura-sync', { body: {} });
  if (error) throw error;
}

export async function getOuraConnected(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profile')
    .select('oura_connected')
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data?.oura_connected);
}

export async function getLatestSnapshot(userId: string): Promise<HealthSnapshot | null> {
  const { data } = await supabase
    .from('health_snapshots')
    .select('date, readiness, sleep_score, hrv, rhr, temp, cycle_day, cycle_phase, raw')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as HealthSnapshot) ?? null;
}
