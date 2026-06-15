-- OURA через Personal Access Token (см. docs/SPEC.md §3.5).
-- PAT не имеет refresh/expiry — делаем эти поля nullable.
alter table private.oura_tokens
  alter column refresh_token drop not null,
  alter column expires_at drop not null;

-- Флаг подключения OURA — читаемый клиентом (сам токен лежит в private, недоступен).
alter table public.profile
  add column if not exists oura_connected boolean not null default false;

-- Цикл (для женщин): фаза в дневном снимке + история начал цикла для расчёта фазы.
alter table public.health_snapshots
  add column if not exists cycle_day   integer,
  add column if not exists cycle_phase text;

create table if not exists public.cycle_periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  start_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, start_date)
);

alter table public.cycle_periods enable row level security;
create policy cycle_periods_all on public.cycle_periods for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- security-definer RPC для доступа к private.oura_tokens из Edge Functions
-- (схема private не экспонирована в API). Вызываются только service_role.
create or replace function public.store_oura_token(p_user uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = private, public
as $$
begin
  insert into private.oura_tokens (user_id, access_token, refresh_token, expires_at)
  values (p_user, p_token, null, null)
  on conflict (user_id) do update set access_token = excluded.access_token;
  update public.profile set oura_connected = true where user_id = p_user;
end;
$$;

create or replace function public.get_oura_token(p_user uuid)
returns text
language plpgsql
security definer
set search_path = private, public
as $$
declare
  tok text;
begin
  select access_token into tok from private.oura_tokens where user_id = p_user;
  return tok;
end;
$$;

-- эти функции работают с секретом — недоступны клиентским ролям, только service_role
revoke execute on function public.store_oura_token(uuid, text) from anon, authenticated;
revoke execute on function public.get_oura_token(uuid) from anon, authenticated;
