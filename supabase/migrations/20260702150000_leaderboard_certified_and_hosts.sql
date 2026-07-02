-- Лидерборд, итерация 2 (фидбек Сергея):
-- 1) «Офіційна сертифікація» — заявитель отмечает, админ подтверждает апрувом; на борде бейдж,
--    при равном результате сертифицированный выше домашнего.
-- 2) video_url — только известные видеохосты (фишинг-ссылку на борд не подсунуть даже через API).

alter table public.leaderboard_entries
  add column if not exists certified boolean not null default false;

-- пересоздаём check: прежний пускал любой https-URL
alter table public.leaderboard_entries drop constraint if exists leaderboard_entries_video_url_check;
alter table public.leaderboard_entries add constraint leaderboard_entries_video_url_check
  check (
    length(video_url) <= 300
    -- vm./vt. — короткие ссылки TikTok (реальная заявка Сергея была на vt.)
    and video_url ~* '^https://(www\.|m\.|vm\.|vt\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|facebook\.com|fb\.watch)/'
  );

-- ---------- RPC с полем certified (меняется return table → drop + create) ----------
drop function if exists public.get_leaderboard(text);
create function public.get_leaderboard(p_board text)
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
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
  verified_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.user_id,
         coalesce(p.display_name, 'Athlete'), p.avatar,
         d.name, e.weight_kg,
         g.brand, g.name, g.rgc, g.rgc_unit,
         e.set_type, e.certified, e.video_url, e.performed_at, e.verified_at
  from public.leaderboard_entries e
  left join public.profile p on p.user_id = e.user_id
  left join public.dynamometers d on d.id = e.dynamometer_id
  left join public.grippers g on g.id = e.gripper_id
  where e.status = 'approved' and e.board = p_board
  order by e.weight_kg desc nulls last, e.verified_at desc
  limit 500;
$$;
revoke execute on function public.get_leaderboard(text) from anon;

drop function if exists public.get_leaderboard_pending();
create function public.get_leaderboard_pending()
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
  certified        boolean,
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
           e.set_type, e.certified, e.video_url, e.note, e.performed_at, e.created_at
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
