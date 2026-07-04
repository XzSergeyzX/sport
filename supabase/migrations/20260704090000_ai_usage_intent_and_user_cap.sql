-- ai_usage: разрез по интентам (видно, кто ест бюджет — коуч/импорт/STT) +
-- per-user месячный $-кап (один разогнавшийся юзер блокирует себя, а не весь ИИ обоим).
-- Хвост аудита дня-46. Данные не трогаем: существующие строки получают intent='' (агрегат до разреза).

-- ---------- ai_usage.intent ----------
alter table public.ai_usage add column if not exists intent text not null default '';

-- intent входит в PK: та же тройка (user, period_type, period_key) теперь копится по интентам
alter table public.ai_usage drop constraint ai_usage_pkey;
alter table public.ai_usage add primary key (user_id, period_type, period_key, intent);

-- ---------- per-user месячный кап ----------
alter table public.ai_limits add column if not exists user_month_cost_cap numeric;
-- $20 при общем потолке $30 на двоих: перекос допустим, тотальный съём бюджета одним — нет
update public.ai_limits set user_month_cost_cap = 20 where user_month_cost_cap is null;

-- ---------- ai_budget_check: агрегаты вместо одной строки + user-кап ----------
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
  cost_u numeric;
begin
  select * into lim from public.ai_limits limit 1;
  if lim.kill_switch then
    return jsonb_build_object('allowed', false, 'reason', 'kill_switch');
  end if;

  -- день: с разрезом по intent строк несколько → суммируем
  select coalesce(sum(requests), 0), coalesce(sum(tokens_in + tokens_out), 0)
    into reqs, toks
    from public.ai_usage
    where user_id = p_user and period_type = 'day' and period_key = d;

  if lim.day_request_cap is not null and reqs >= lim.day_request_cap then
    return jsonb_build_object('allowed', false, 'reason', 'day_request_cap');
  end if;
  if lim.day_token_cap is not null and toks >= lim.day_token_cap then
    return jsonb_build_object('allowed', false, 'reason', 'day_token_cap');
  end if;

  -- месячный $-кап конкретного юзера
  select coalesce(sum(cost_estimate), 0) into cost_u
    from public.ai_usage
    where user_id = p_user and period_type = 'month' and period_key = m;
  if lim.user_month_cost_cap is not null and cost_u >= lim.user_month_cost_cap then
    return jsonb_build_object('allowed', false, 'reason', 'user_month_cost_cap');
  end if;

  -- общий месячный $-потолок (kill по деньгам)
  select coalesce(sum(cost_estimate), 0) into cost_m
    from public.ai_usage where period_type = 'month' and period_key = m;
  if lim.month_cost_cap is not null and cost_m >= lim.month_cost_cap then
    return jsonb_build_object('allowed', false, 'reason', 'month_cost_cap');
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

-- ---------- ai_record_usage: + p_intent (default '' — transcribe зовёт без него) ----------
drop function if exists public.ai_record_usage(uuid, integer, integer, numeric);

create or replace function public.ai_record_usage(
  p_user uuid, p_tokens_in integer, p_tokens_out integer, p_cost numeric, p_intent text default ''
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
  insert into public.ai_usage (user_id, period_type, period_key, intent, tokens_in, tokens_out, requests, cost_estimate)
  values
    (p_user, 'day',   d, p_intent, p_tokens_in, p_tokens_out, 1, p_cost),
    (p_user, 'week',  w, p_intent, p_tokens_in, p_tokens_out, 1, p_cost),
    (p_user, 'month', m, p_intent, p_tokens_in, p_tokens_out, 1, p_cost)
  on conflict (user_id, period_type, period_key, intent) do update set
    tokens_in     = public.ai_usage.tokens_in  + excluded.tokens_in,
    tokens_out    = public.ai_usage.tokens_out + excluded.tokens_out,
    requests      = public.ai_usage.requests   + 1,
    cost_estimate = public.ai_usage.cost_estimate + excluded.cost_estimate;
end;
$$;

revoke execute on function public.ai_budget_check(uuid) from anon, authenticated;
revoke execute on function public.ai_record_usage(uuid, integer, integer, numeric, text) from anon, authenticated;
