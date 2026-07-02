-- Очередь модерации лидерборда для админа: pending-заявки с именами/железом.
-- Отдельный security definer RPC: политика lb_select_admin даёт админу строки entries,
-- но profile чужих юзеров клиенту не виден (RLS) — имена достаём только этим окном.
create or replace function public.get_leaderboard_pending()
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
  board            text,
  dynamometer      text,
  weight_kg        numeric,
  gripper_brand    text,
  gripper_name     text,
  gripper_rgc      numeric,
  gripper_rgc_unit text,
  set_type         text,
  video_url        text,
  note             text,
  performed_at     date,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin'
  ) then
    raise exception 'not_admin';
  end if;
  return query
    select e.id, e.user_id,
           coalesce(p.display_name, 'Athlete'), p.avatar,
           e.board,
           d.name, e.weight_kg,
           g.brand, g.name, g.rgc, g.rgc_unit,
           e.set_type, e.video_url, e.note, e.performed_at, e.created_at
    from public.leaderboard_entries e
    left join public.profile p on p.user_id = e.user_id
    left join public.dynamometers d on d.id = e.dynamometer_id
    left join public.grippers g on g.id = e.gripper_id
    where e.status = 'pending'
    order by e.created_at asc
    limit 200;
end;
$$;

revoke execute on function public.get_leaderboard_pending() from anon;
