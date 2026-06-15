-- Кластеры/круги в тренировке: денормализованный снимок блока программы на упражнении.
-- Позволяет группировать упражнения круга (кола/EMOM/суперсет) в активной тренировке.
alter table public.workout_exercises
  add column if not exists block_key    text,     -- id блока программы (группировка)
  add column if not exists block_label  text,     -- подпись блока («3 кола», «EMOM 16»)
  add column if not exists block_rounds integer;  -- число кругов, если задано
