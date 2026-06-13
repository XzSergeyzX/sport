-- Sporty_SM — начальная схема (см. docs/SPEC.md §4)
-- Все пользовательские таблицы в public с RLS (owner = auth.uid()).
-- Секреты (OURA-токены) — в схеме private, не доступной через PostgREST.

create schema if not exists private;

-- ---------- профиль ----------
create table if not exists public.profile (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  language    text not null default 'en' check (language in ('en', 'uk')),
  units       text not null default 'kg' check (units in ('kg', 'lb')),
  height_cm   numeric,
  bodyweight  numeric,
  prefs       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- каталог упражнений ----------
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid references auth.users (id) on delete cascade, -- NULL = глобальное
  name_en      text not null,
  name_uk      text not null,
  muscle_group text,
  equipment    text,
  aliases      text[] not null default '{}',
  is_global    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists exercises_owner_idx on public.exercises (owner_id);

-- ---------- тренировки ----------
create table if not exists public.workouts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  title      text,
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists workouts_user_idx on public.workouts (user_id, started_at desc);

create table if not exists public.workout_exercises (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  order_index integer not null default 0
);
create index if not exists workout_exercises_workout_idx on public.workout_exercises (workout_id);

create table if not exists public.sets (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  reps                integer,
  weight              numeric,
  rest_sec            integer,
  rpe                 numeric check (rpe is null or (rpe >= 1 and rpe <= 10)),
  note                text,
  completed_at        timestamptz not null default now()
);
create index if not exists sets_we_idx on public.sets (workout_exercise_id);

-- ---------- рекорды ----------
create table if not exists public.personal_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  type        text not null,           -- '1rm_est' | 'max_weight' | 'max_reps' | 'max_volume'
  value       numeric not null,
  achieved_at timestamptz not null default now()
);
create index if not exists pr_user_idx on public.personal_records (user_id, exercise_id);

-- ---------- здоровье / OURA ----------
create table if not exists public.health_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  readiness   integer,
  sleep_score integer,
  hrv         numeric,
  rhr         numeric,
  temp        numeric,
  raw         jsonb,
  unique (user_id, date)
);

-- ---------- ИИ ----------
create table if not exists public.ai_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.ai_threads (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'system')),
  content    text not null,
  provider   text,
  model      text,
  tokens_in  integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_thread_idx on public.ai_messages (thread_id, created_at);

-- учёт лимитов; пишет только сервер (service_role обходит RLS), юзер только читает
create table if not exists public.ai_usage (
  user_id       uuid not null references auth.users (id) on delete cascade,
  period_type   text not null check (period_type in ('day', 'week', 'month')),
  period_key    text not null,        -- '2026-06-13' | '2026-W24' | '2026-06'
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  requests      integer not null default 0,
  cost_estimate numeric not null default 0,
  primary key (user_id, period_type, period_key)
);

create table if not exists public.video_analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid references public.exercises (id),
  summary     text not null,          -- клип не хранится, только текстовое саммари
  created_at  timestamptz not null default now()
);

-- секреты OURA — приватная схема, недоступна клиенту
create table if not exists private.oura_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.profile           enable row level security;
alter table public.exercises         enable row level security;
alter table public.workouts          enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.sets              enable row level security;
alter table public.personal_records  enable row level security;
alter table public.health_snapshots  enable row level security;
alter table public.ai_threads        enable row level security;
alter table public.ai_messages       enable row level security;
alter table public.ai_usage          enable row level security;
alter table public.video_analyses    enable row level security;

-- profile
create policy profile_select on public.profile for select using (user_id = auth.uid());
create policy profile_insert on public.profile for insert with check (user_id = auth.uid());
create policy profile_update on public.profile for update using (user_id = auth.uid());

-- exercises: видно глобальные + свои; менять можно только свои
create policy exercises_select on public.exercises for select
  using (is_global or owner_id = auth.uid());
create policy exercises_insert on public.exercises for insert
  with check (owner_id = auth.uid());
create policy exercises_update on public.exercises for update
  using (owner_id = auth.uid());
create policy exercises_delete on public.exercises for delete
  using (owner_id = auth.uid());

-- workouts
create policy workouts_all on public.workouts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- workout_exercises: владение через workouts
create policy we_all on public.workout_exercises for all
  using (exists (select 1 from public.workouts w
                 where w.id = workout_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.workouts w
                      where w.id = workout_id and w.user_id = auth.uid()));

-- sets: владение через workout_exercises → workouts
create policy sets_all on public.sets for all
  using (exists (select 1 from public.workout_exercises we
                 join public.workouts w on w.id = we.workout_id
                 where we.id = workout_exercise_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.workout_exercises we
                      join public.workouts w on w.id = we.workout_id
                      where we.id = workout_exercise_id and w.user_id = auth.uid()));

create policy pr_all on public.personal_records for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy health_all on public.health_snapshots for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy ai_threads_all on public.ai_threads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy ai_messages_all on public.ai_messages for all
  using (exists (select 1 from public.ai_threads t
                 where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_threads t
                      where t.id = thread_id and t.user_id = auth.uid()));

-- ai_usage: юзер только читает; запись — серверной функцией (service_role)
create policy ai_usage_select on public.ai_usage for select using (user_id = auth.uid());

create policy video_select on public.video_analyses for select using (user_id = auth.uid());
create policy video_insert on public.video_analyses for insert with check (user_id = auth.uid());
create policy video_delete on public.video_analyses for delete using (user_id = auth.uid());

-- =====================================================================
-- авто-создание профиля при регистрации
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', null))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
