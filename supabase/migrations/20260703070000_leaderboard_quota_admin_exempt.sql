-- Антиспам-лимит 5 заявок/24ч не применяется к admin: модератор верифицирует борд
-- и постоянно гоняет тестовые заявки. Для grip/full лимит остаётся как был.
create or replace function public.leaderboard_entry_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.user_roles
             where user_id = new.user_id and role = 'admin') then
    return new;
  end if;
  if (select count(*) from public.leaderboard_entries
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'daily_entry_limit';
  end if;
  return new;
end;
$$;
