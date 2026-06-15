-- Флоу тренировки: отметка «подход сделан» (logged_at) и «упражнение завершено» (done_at).
-- Отдых меряем по факту: rest_sec = разрыв между logged_at соседних сделанных подходов.
-- completed_at остаётся временем создания строки (порядок подходов).

alter table public.sets
  add column if not exists logged_at timestamptz;

alter table public.workout_exercises
  add column if not exists done_at timestamptz;
