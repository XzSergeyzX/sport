-- Глобальный сид-каталог упражнений (owner_id = NULL, is_global = true).
-- Идемпотентно: уникальный индекс по name_en среди глобальных + ON CONFLICT.

create unique index if not exists exercises_global_name_uidx
  on public.exercises (name_en) where is_global;

insert into public.exercises (name_en, name_uk, muscle_group, equipment, aliases, is_global)
values
  -- база / классика
  ('Back Squat',        'Присід зі штангою',        'legs',      'barbell',    array['squat','back squat','присід','присід зі штангою'], true),
  ('Bench Press',       'Жим лежачи',               'chest',     'barbell',    array['bench','bench press','жим лежачи'], true),
  ('Deadlift',          'Станова тяга',             'back',      'barbell',    array['deadlift','станова тяга','тяга'], true),
  ('Pull-up',           'Підтягування',             'back',      'bodyweight', array['pull-up','pullup','підтягування'], true),
  ('Assisted Pull-up',  'Підтягування з допомогою', 'back',      'machine',    array['assisted pull-up','підтягування з допомогою'], true),
  ('Push-up',           'Віджимання',               'chest',     'bodyweight', array['push-up','pushup','віджимання'], true),
  ('Overhead Press',    'Жим стоячи',               'shoulders', 'barbell',    array['ohp','overhead press','жим стоячи'], true),
  -- армрестлинг
  ('Low Pulley Side Pull',      'Натяжка з нижнього блока', 'forearms', 'cable', array['side pull','low pulley','натяжка','натяжка з нижнього блока'], true),
  ('Wrist Curl on Strap Handle','Кисть на лямках',          'forearms', 'cable', array['wrist','кисть','ручка','strap'], true),
  ('Pronation',                 'Пронація',                 'forearms', 'cable', array['pronation','пронація'], true),
  ('Movement Imitation',        'Імітація руху',            'arms',     'cable', array['imitation','імітація','імітація руху'], true),
  -- гири
  ('Kettlebell Snatch',     'Ривок гирі',        'full_body', 'kettlebell', array['snatch','ривок','ривок гирі'], true),
  ('Kettlebell Press',      'Жим гирі',          'shoulders', 'kettlebell', array['kb press','жим гирі'], true),
  ('Kettlebell Push Press', 'Швунг гирі',        'shoulders', 'kettlebell', array['push press','швунг','швунг гирі'], true),
  ('Bulgarian Split Squat', 'Болгарський випад', 'legs',      'kettlebell', array['bulgarian','болгарський випад','болгари'], true),
  ('Lunges',                'Випади',            'legs',      'kettlebell', array['lunge','lunges','випади'], true)
on conflict (name_en) where is_global do nothing;
