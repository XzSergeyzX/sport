-- Богатый дневной снимок OURA для аналитики: одна строка на (user_id, date),
-- сохраняем ВСЁ, что отдаёт OURA v2. Колонки — для чистого SQL; contributors/raw — jsonb.
-- Бэкафилл: oura-sync апсертит каждый день диапазона (никогда не удаляем → копится ряд).

alter table public.health_snapshots
  -- recovery / readiness
  add column if not exists temp_trend                numeric,   -- temperature_trend_deviation
  add column if not exists avg_hr                    numeric,   -- average_heart_rate (сон)
  add column if not exists readiness_contributors    jsonb,
  -- sleep (детальный период + daily_sleep)
  add column if not exists respiratory_rate          numeric,   -- average_breath
  add column if not exists sleep_total_min           numeric,   -- total_sleep_duration / 60
  add column if not exists time_in_bed_min           numeric,
  add column if not exists sleep_efficiency          numeric,
  add column if not exists sleep_latency_min         numeric,
  add column if not exists sleep_deep_min            numeric,
  add column if not exists sleep_rem_min             numeric,
  add column if not exists sleep_light_min           numeric,
  add column if not exists restless_periods          integer,
  add column if not exists bedtime_start             timestamptz,
  add column if not exists bedtime_end               timestamptz,
  add column if not exists sleep_contributors        jsonb,
  -- activity
  add column if not exists activity_score            integer,
  add column if not exists steps                     integer,
  add column if not exists active_calories           integer,
  add column if not exists total_calories            integer,
  add column if not exists walking_distance_m        numeric,   -- equivalent_walking_distance
  add column if not exists met_minutes               numeric,   -- average_met_minutes
  add column if not exists sedentary_min             numeric,
  add column if not exists active_high_min           numeric,
  add column if not exists active_medium_min         numeric,
  add column if not exists active_low_min            numeric,
  add column if not exists resting_min               numeric,
  add column if not exists activity_contributors     jsonb,
  -- spo2 / stress / долгосрочные
  add column if not exists spo2_avg                  numeric,
  add column if not exists breathing_disturbance_idx numeric,
  add column if not exists stress_high_min           numeric,   -- daily_stress.stress_high (сек→мин)
  add column if not exists recovery_high_min         numeric,   -- daily_stress.recovery_high
  add column if not exists stress_summary            text,      -- day_summary (restored/normal/stressful)
  add column if not exists resilience_level          text,
  add column if not exists resilience_contributors   jsonb,
  add column if not exists vascular_age              numeric,   -- daily_cardiovascular_age
  add column if not exists vo2_max                   numeric;

-- индекс под выборки диапазона по дате (аналитика «по календарю»)
create index if not exists health_snapshots_user_date_idx
  on public.health_snapshots (user_id, date);
