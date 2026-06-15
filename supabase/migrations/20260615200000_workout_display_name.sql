-- Имя упражнения «как в программе» (чистое) — показываем его в тренировке,
-- чтобы отображение не зависело от того, на какой каталог сматчилось упражнение.
alter table public.workout_exercises
  add column if not exists display_name text;
