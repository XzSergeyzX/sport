-- Временной тип подхода: удержания/планки/виси измеряются в СЕКУНДАХ, а не повторах.
-- Метрика живёт на упражнении (default 'reps'); секунды — на самом подходе.

-- Метрика по умолчанию для упражнения: повторы или время.
alter table public.exercises add column if not exists metric text not null default 'reps';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exercises_metric_chk') then
    alter table public.exercises
      add constraint exercises_metric_chk check (metric in ('reps', 'time'));
  end if;
end $$;

-- Длительность подхода в секундах (для временных упражнений). Повторы остаются для обычных.
alter table public.sets         add column if not exists duration_sec integer;
alter table public.program_sets add column if not exists target_duration_sec integer;

-- Помечаем явные удержания из глобального каталога как временные (по точному имени —
-- без регулярок, чтобы не задеть обычные упражнения вроде «Прогулянка фермера»).
update public.exercises set metric = 'time'
where is_global
  and metric = 'reps'
  and name_en in ('Dead Hang', 'Handstand Hold', 'Plank', 'Side Plank', 'Hollow Hold', 'L-sit');
