-- Ревизия глобального каталога (см. docs/CATALOG_REVIEW.md):
--  • разметка is_base (база видна всем; специфика — по включённым дисциплинам)
--  • удаление мусорной «Імітація руху»
--  • расширение армрестлінг-словника
--  • новый словник «Сила хвата» (grip): эспандер (close/hold) + динамометр
--  • перенос Plate Pinch в grip, но оставляем базовым (щипок делают все)

-- 1) База: всё «general» + универсальные базовые движения видно всем.
update public.exercises set is_base = true
where is_global
  and (category = 'general'
       or name_en in ('Pull-up', 'Push-up', 'Sit-up', 'Hanging Leg Raise'));

-- 2) Мусорная карточка — убираем. Безопасно: если на неё уже ссылаются тренировки/программы,
--    оставляем (чтобы миграция не падала на FK) — тогда подчистим вручную позже.
delete from public.exercises e
where e.is_global and e.name_en = 'Movement Imitation'
  and not exists (select 1 from public.workout_exercises we where we.exercise_id = e.id)
  and not exists (select 1 from public.program_exercises pe where pe.exercise_id = e.id);

-- 3) Plate Pinch → словник «Сила хвата», но базовый (доступен всем).
update public.exercises
  set category = 'grip', is_base = true, metric = 'time'
  where is_global and name_en = 'Plate Pinch';

-- 4) Армрестлінг-словник + словник «Сила хвата».
insert into public.exercises
  (name_en, name_uk, muscle_group, equipment, aliases, cluster, category, metric, is_base, log_kind, is_global)
values
  -- армрестлінг (специфика, is_base=false)
  ('Radial Deviation (cable)', 'Луч (нижній блок)', 'forearms', 'cable',
   array['луч','luch','radial','радіальне','луч нижній блок','луч нижний блок'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Wrist Curl (wide handle)', 'Кисть широкою ручкою', 'forearms', 'cable',
   array['кисть широкою ручкою','широка ручка','wide handle','кисть широкой ручкой'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Wrist Curl (rolling handle)', 'Кисть роллінгом', 'forearms', 'cable',
   array['кисть роллінгом','роллінг','rolling handle','кисть роллингом'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Top-roll Imitation', 'Імітація руху верхом', 'forearms', 'cable',
   array['імітація руху верхом','верхом','top roll','топ рол','имитация верхом'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Hook Imitation', 'Імітація руху в крюк', 'forearms', 'cable',
   array['імітація руху в крюк','крюк','гак','hook','имитация в крюк'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Wrist Abduction', 'Відведення', 'forearms', 'cable',
   array['відведення','abduction','отведение'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Side Pull (abduction)', 'Натяжка через відведення', 'forearms', 'cable',
   array['натяжка через відведення','натяжка відведенням','side pull abduction','натяжка через отведение'], 'upper', 'armwrestling', 'reps', false, null, true),
  ('Table Side Pull (static)', 'Натяжка за столом (статика)', 'forearms', 'other',
   array['натяжка за столом','за столом','table side pull','статика за столом','натяжка стіл'], 'upper', 'armwrestling', 'time', false, null, true),
  -- сила хвата (специфика, is_base=false)
  ('Gripper Close', 'Стиснення еспандера', 'forearms', 'other',
   array['стиснення еспандера','еспандер','стиснення','gripper','gripper close','сжатие эспандера','эспандер'], 'upper', 'grip', 'reps', false, 'gripper', true),
  ('Gripper Static Hold', 'Статичне утримання еспандера', 'forearms', 'other',
   array['статичне утримання еспандера','утримання еспандера','gripper hold','статика эспандера','удержание эспандера'], 'upper', 'grip', 'time', false, 'gripper', true),
  ('Dynamometer', 'Динамометр', 'forearms', 'other',
   array['динамометр','dynamometer','динамо'], 'upper', 'grip', 'reps', false, null, true)
on conflict (name_en) where is_global do update set
  name_uk      = excluded.name_uk,
  muscle_group = excluded.muscle_group,
  equipment    = excluded.equipment,
  aliases      = excluded.aliases,
  cluster      = excluded.cluster,
  category     = excluded.category,
  metric       = excluded.metric,
  is_base      = excluded.is_base,
  log_kind     = excluded.log_kind;
