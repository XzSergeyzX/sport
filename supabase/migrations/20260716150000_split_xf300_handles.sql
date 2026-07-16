-- XF-300 с рукоятью 14 мм и 18 мм — разные дисциплины и отдельные рейтинги.
-- Старую неоднозначную категорию не удаляем: деактивация сохраняет FK/историю.
insert into public.dynamometers (code, name, is_active, sort_order) values
  ('xf300_14mm', 'XF-300 · 14 mm', true, 2),
  ('xf300_18mm', 'XF-300 · 18 mm', true, 3)
on conflict (code) do update
set name = excluded.name,
    is_active = true,
    sort_order = excluded.sort_order;

update public.dynamometers
set is_active = false, sort_order = 99
where code = 'xf300';

update public.dynamometers
set sort_order = 4
where code = 'gd';

-- Клиент показывает только active, но это не защита: запрещаем подачу в старую категорию
-- и через прямой PostgREST/устаревший APK. Триггер не срабатывает на смену status при модерации.
create or replace function public.leaderboard_validate_active_dynamometer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.board = 'dynamometer' and not exists (
    select 1 from public.dynamometers d
    where d.id = new.dynamometer_id and d.is_active
  ) then
    raise exception 'inactive_dynamometer';
  end if;
  return new;
end;
$$;

revoke execute on function public.leaderboard_validate_active_dynamometer() from public, anon, authenticated;

drop trigger if exists leaderboard_active_dynamometer on public.leaderboard_entries;
create trigger leaderboard_active_dynamometer
before insert or update of board, dynamometer_id on public.leaderboard_entries
for each row execute function public.leaderboard_validate_active_dynamometer();

-- Фильтруем стабильной категорией ДО limit 500. Иначе общий лимит мог вытеснить
-- результаты конкретного прибора/сет-типа ещё до клиентского фильтра.
-- Старый get_leaderboard(text) сохраняем как compatibility overload для APK до OTA.
revoke execute on function public.get_leaderboard(text) from public, anon;
grant execute on function public.get_leaderboard(text) to authenticated;

create function public.get_leaderboard(
  p_board text,
  p_dynamometer_code text,
  p_set_type text
)
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
  bodyweight       numeric,
  dynamometer_code text,
  dynamometer      text,
  weight_kg        numeric,
  gripper_brand    text,
  gripper_name     text,
  gripper_rgc      numeric,
  gripper_rgc_unit text,
  set_type         text,
  certified        boolean,
  video_url        text,
  performed_at     date,
  verified_at      timestamptz,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.user_id,
         coalesce(p.display_name, 'Athlete'), p.avatar, p.bodyweight,
         d.code, d.name, e.weight_kg,
         g.brand, g.name, g.rgc, g.rgc_unit,
         e.set_type, e.certified, e.video_url, e.performed_at, e.verified_at, e.created_at
  from public.leaderboard_entries e
  left join public.profile p on p.user_id = e.user_id
  left join public.dynamometers d on d.id = e.dynamometer_id
  left join public.grippers g on g.id = e.gripper_id
  where e.status = 'approved'
    and e.board = p_board
    and (p_board <> 'dynamometer' or d.code = p_dynamometer_code)
    and (p_board <> 'gripper' or p_set_type is null or e.set_type = p_set_type)
  order by e.weight_kg desc nulls last, e.verified_at desc
  limit 500;
$$;

revoke execute on function public.get_leaderboard(text, text, text) from public, anon;
grant execute on function public.get_leaderboard(text, text, text) to authenticated;

-- Защита от тихого возврата общей категории при повторных сидах/ручных правках.
do $$
begin
  if (select count(*) from public.dynamometers
      where code in ('xf300_14mm', 'xf300_18mm') and is_active) <> 2 then
    raise exception 'xf300 split invariant failed';
  end if;
  if exists (select 1 from public.dynamometers where code = 'xf300' and is_active) then
    raise exception 'legacy xf300 category must be inactive';
  end if;
end;
$$;
