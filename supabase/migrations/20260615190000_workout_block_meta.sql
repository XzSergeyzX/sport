-- Доп. снимок блока на упражнении тренировки: тип (emom/e2mom/rounds…) и интервал.
-- Нужно для отображения раундов и минутного таймера EMOM в активной тренировке.
alter table public.workout_exercises
  add column if not exists block_type         text,
  add column if not exists block_interval_sec integer;
