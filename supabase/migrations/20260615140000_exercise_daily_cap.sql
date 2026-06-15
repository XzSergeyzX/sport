-- Антиспам на кастомные упражнения: не больше N в день на пользователя.
-- Серверные операции (импорт программ под service_role) идут БЕЗ auth.uid() — их не лимитируем.
-- Приватность («только для себя») уже обеспечена RLS: owner_id = auth.uid(), is_global=false.

create or replace function public.enforce_exercise_daily_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt integer;
  cap constant integer := 20;  -- лимит ручного добавления в день (меняется тут)
begin
  -- service_role (импорт/серверные джобы) — без пользовательского JWT, не ограничиваем
  if auth.uid() is null then
    return new;
  end if;
  -- глобальные упражнения через клиент всё равно не создать (RLS), но на всякий
  if new.owner_id is null then
    return new;
  end if;

  select count(*) into cnt
    from public.exercises
    where owner_id = new.owner_id
      and created_at >= date_trunc('day', now());

  if cnt >= cap then
    raise exception 'exercise_daily_cap' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists exercises_daily_cap on public.exercises;
create trigger exercises_daily_cap
  before insert on public.exercises
  for each row execute function public.enforce_exercise_daily_cap();
