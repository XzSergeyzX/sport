-- ИИ-гейтвей (роутинг по интентам + лимиты/бюджет) и Программы (§3.7).
-- Ключи провайдеров НЕ здесь и НЕ в клиенте — они в секретах Edge Functions.

-- ---------- роутинг моделей ----------
-- intent → провайдер/модель + цены (для оценки стоимости). Меняется одной строкой.
create table if not exists public.ai_model_routes (
  intent     text primary key,
  provider   text not null check (provider in ('openai', 'anthropic', 'gemini')),
  model      text not null,
  price_in   numeric not null default 0,   -- $ за 1M входных токенов
  price_out  numeric not null default 0,   -- $ за 1M выходных токенов
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.ai_model_routes (intent, provider, model, price_in, price_out, enabled) values
  ('program_import', 'openai',    'gpt-5.4-mini',              0.75, 4.50, true),
  ('classify',       'openai',    'gpt-5.4-mini',              0.75, 4.50, true),
  ('coach_chat',     'anthropic', 'claude-haiku-4-5-20251001', 1.00, 5.00, true),
  ('vision_import',  'gemini',    'gemini-flash',              0.30, 2.50, false)
on conflict (intent) do nothing;

-- ---------- лимиты / бюджет (одна глобальная строка) ----------
create table if not exists public.ai_limits (
  id              boolean primary key default true check (id),
  kill_switch     boolean not null default false,
  day_token_cap   integer,           -- на пользователя в день
  week_token_cap  integer,
  month_token_cap integer,
  month_cost_cap  numeric,           -- общий $-потолок за месяц (kill по деньгам)
  day_request_cap integer,           -- сообщений/запросов на пользователя в день
  updated_at      timestamptz not null default now()
);

insert into public.ai_limits (id, month_cost_cap, day_request_cap, day_token_cap)
values (true, 30, 60, 200000)
on conflict (id) do nothing;

-- ---------- программы (§3.7) ----------
create table if not exists public.programs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  source     text,                   -- 'ai_import' | 'manual'
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists programs_user_idx on public.programs (user_id, created_at desc);

create table if not exists public.program_exercises (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs (id) on delete cascade,
  exercise_id uuid references public.exercises (id),  -- сматчено с каталогом; NULL = не нашли
  name        text not null,                          -- как пришло из импорта (показать как есть)
  order_index integer not null default 0,
  notes       text
);
create index if not exists program_exercises_program_idx on public.program_exercises (program_id, order_index);

create table if not exists public.program_sets (
  id                  uuid primary key default gen_random_uuid(),
  program_exercise_id uuid not null references public.program_exercises (id) on delete cascade,
  order_index         integer not null default 0,
  target_reps         integer,
  target_weight       numeric,
  target_rpe          numeric check (target_rpe is null or (target_rpe >= 1 and target_rpe <= 10)),
  rest_sec            integer,
  notes               text
);
create index if not exists program_sets_pe_idx on public.program_sets (program_exercise_id, order_index);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.ai_model_routes   enable row level security;
alter table public.ai_limits         enable row level security;
alter table public.programs          enable row level security;
alter table public.program_exercises enable row level security;
alter table public.program_sets      enable row level security;

-- роуты/лимиты: читать может любой залогиненный (секретов тут нет); запись — только service_role
create policy ai_model_routes_select on public.ai_model_routes for select using (auth.uid() is not null);
create policy ai_limits_select       on public.ai_limits       for select using (auth.uid() is not null);

create policy programs_all on public.programs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy program_exercises_all on public.program_exercises for all
  using (exists (select 1 from public.programs p
                 where p.id = program_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.programs p
                      where p.id = program_id and p.user_id = auth.uid()));

create policy program_sets_all on public.program_sets for all
  using (exists (select 1 from public.program_exercises pe
                 join public.programs p on p.id = pe.program_id
                 where pe.id = program_exercise_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.program_exercises pe
                      join public.programs p on p.id = pe.program_id
                      where pe.id = program_exercise_id and p.user_id = auth.uid()));

-- =====================================================================
-- RPC: проверка бюджета и учёт расхода (только service_role)
-- =====================================================================
create or replace function public.ai_budget_check(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lim    public.ai_limits;
  d      text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD');
  m      text := to_char((now() at time zone 'utc'), 'YYYY-MM');
  reqs   integer;
  toks   integer;
  cost_m numeric;
begin
  select * into lim from public.ai_limits limit 1;
  if lim.kill_switch then
    return jsonb_build_object('allowed', false, 'reason', 'kill_switch');
  end if;

  select requests, tokens_in + tokens_out into reqs, toks
    from public.ai_usage
    where user_id = p_user and period_type = 'day' and period_key = d;
  reqs := coalesce(reqs, 0);
  toks := coalesce(toks, 0);

  if lim.day_request_cap is not null and reqs >= lim.day_request_cap then
    return jsonb_build_object('allowed', false, 'reason', 'day_request_cap');
  end if;
  if lim.day_token_cap is not null and toks >= lim.day_token_cap then
    return jsonb_build_object('allowed', false, 'reason', 'day_token_cap');
  end if;

  select coalesce(sum(cost_estimate), 0) into cost_m
    from public.ai_usage where period_type = 'month' and period_key = m;
  if lim.month_cost_cap is not null and cost_m >= lim.month_cost_cap then
    return jsonb_build_object('allowed', false, 'reason', 'month_cost_cap');
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.ai_record_usage(
  p_user uuid, p_tokens_in integer, p_tokens_out integer, p_cost numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD');
  w text := to_char((now() at time zone 'utc'), 'IYYY"-W"IW');
  m text := to_char((now() at time zone 'utc'), 'YYYY-MM');
begin
  insert into public.ai_usage (user_id, period_type, period_key, tokens_in, tokens_out, requests, cost_estimate)
  values
    (p_user, 'day',   d, p_tokens_in, p_tokens_out, 1, p_cost),
    (p_user, 'week',  w, p_tokens_in, p_tokens_out, 1, p_cost),
    (p_user, 'month', m, p_tokens_in, p_tokens_out, 1, p_cost)
  on conflict (user_id, period_type, period_key) do update set
    tokens_in     = public.ai_usage.tokens_in  + excluded.tokens_in,
    tokens_out    = public.ai_usage.tokens_out + excluded.tokens_out,
    requests      = public.ai_usage.requests   + 1,
    cost_estimate = public.ai_usage.cost_estimate + excluded.cost_estimate;
end;
$$;

revoke execute on function public.ai_budget_check(uuid) from anon, authenticated;
revoke execute on function public.ai_record_usage(uuid, integer, integer, numeric) from anon, authenticated;
