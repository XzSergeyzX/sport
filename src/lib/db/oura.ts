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
  // recovery / readiness
  readiness: number | null;
  temp: number | null;
  temp_trend: number | null;
  readiness_contributors: Record<string, number> | null;
  // sleep
  sleep_score: number | null;
  sleep_contributors: Record<string, number> | null;
  hrv: number | null;
  rhr: number | null;
  avg_hr: number | null;
  respiratory_rate: number | null;
  sleep_total_min: number | null;
  time_in_bed_min: number | null;
  sleep_efficiency: number | null;
  sleep_latency_min: number | null;
  sleep_deep_min: number | null;
  sleep_rem_min: number | null;
  sleep_light_min: number | null;
  restless_periods: number | null;
  bedtime_start: string | null;
  bedtime_end: string | null;
  // activity
  activity_score: number | null;
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
  walking_distance_m: number | null;
  met_minutes: number | null;
  active_high_min: number | null;
  active_medium_min: number | null;
  active_low_min: number | null;
  sedentary_min: number | null;
  resting_min: number | null;
  activity_contributors: Record<string, number> | null;
  // spo2 / stress / долгосрочные
  spo2_avg: number | null;
  breathing_disturbance_idx: number | null;
  stress_high_min: number | null;
  recovery_high_min: number | null;
  stress_summary: string | null;
  resilience_level: string | null;
  resilience_contributors: Record<string, number> | null;
  vascular_age: number | null;
  vo2_max: number | null;
  // цикл (для женщин)
  cycle_day: number | null;
  cycle_phase: string | null;
  raw: OuraRaw;
};

/** Сохранить OURA Personal Access Token (через Edge Function, токен на сервере). */
export async function connectOura(token: string): Promise<void> {
  const { error } = await supabase.functions.invoke('oura-connect', { body: { token } });
  if (error) throw error;
}

/**
 * Подтянуть данные OURA в health_snapshots (через Edge Function).
 * days — глубина бэкафилла (по умолчанию 30; до ~2000 для разовой полной истории).
 */
export type EndpointDiag = { status: number; count: number; latest: string | null };
export type SyncResult = {
  days?: number;
  from?: string;
  to?: string;
  note?: string;
  error?: string;
  diag?: Record<string, EndpointDiag>;
};

export async function syncOura(days?: number): Promise<SyncResult | null> {
  const { data, error } = await supabase.functions.invoke('oura-sync', {
    body: days ? { days } : {},
  });
  if (error) throw error;
  return (data ?? null) as SyncResult | null;
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
  // берём последний день, где есть «утренние» данные (готовність/сон) — кольцо носят не всегда;
  // дни без них (только активность) не должны маскировать последнее реальное утреннее чтение.
  const { data } = await supabase
    .from('health_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(7);
  const rows = (data ?? []) as HealthSnapshot[];
  // последний день с ЛЮБЫМИ ночными данными: детальный сон (HRV/RHR/тривалість) приходит
  // в API раньше дневных оценок (readiness/sleep score), поэтому не ждём именно оценок —
  // иначе сегодняшний день прятался и показывался вчерашний.
  return (
    rows.find(
      (r) =>
        r.readiness != null ||
        r.sleep_score != null ||
        r.hrv != null ||
        r.rhr != null ||
        r.sleep_total_min != null,
    ) ??
    rows[0] ??
    null
  );
}

/** Ряд снимков от даты (YYYY-MM-DD) до сегодня — для аналитики «по календарю». */
export async function getSnapshotsRange(userId: string, fromYmd: string): Promise<HealthSnapshot[]> {
  const { data, error } = await supabase
    .from('health_snapshots')
    .select('*')
    .eq('user_id', userId)
    .gte('date', fromYmd)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HealthSnapshot[];
}
