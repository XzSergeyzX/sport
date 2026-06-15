-- Блоки/кластеры в программах: кола (rounds), EMOM, E2MOM, AMRAP, суперсеты, интервалы.
-- Кроссфит-схемы группируют упражнения — раньше импорт плющил их в плоский список.

create table if not exists public.program_blocks (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references public.programs (id) on delete cascade,
  order_index  integer not null default 0,
  type         text,            -- rounds | emom | e2mom | amrap | for_time | superset | interval | single
  label        text,            -- человекочитаемая подпись («3 кола», «EMOM 16»), как у пользователя
  rounds       integer,         -- кол-во кругов
  interval_sec integer,         -- интервал (EMOM=60, E2MOM=120)
  duration_sec integer,         -- общая длительность блока (EMOM 16 → 960)
  rest_sec     integer,         -- отдых между кругами
  note         text
);
create index if not exists program_blocks_program_idx on public.program_blocks (program_id, order_index);

-- привязка упражнения к блоку (NULL = старые/несгруппированные)
alter table public.program_exercises
  add column if not exists block_id uuid references public.program_blocks (id) on delete cascade;
create index if not exists program_exercises_block_idx on public.program_exercises (block_id, order_index);

alter table public.program_blocks enable row level security;
create policy program_blocks_all on public.program_blocks for all
  using (exists (select 1 from public.programs p
                 where p.id = program_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.programs p
                      where p.id = program_id and p.user_id = auth.uid()));
