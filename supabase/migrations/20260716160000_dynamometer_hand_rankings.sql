-- Каждая новая заявка динамометра относится ровно к одной руке.
-- Старые approved-заявки сохраняем с hand=null: сторону по одному числу/видео-URL угадывать нельзя.
alter table public.leaderboard_entries
  add column if not exists hand text;

alter table public.leaderboard_entries
  drop constraint if exists leaderboard_entries_hand_check;
alter table public.leaderboard_entries
  add constraint leaderboard_entries_hand_check
  check (hand is null or hand in ('left', 'right'));

create or replace function public.leaderboard_validate_hand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Новые заявки и переход pending→approved обязаны иметь руку. Исторические approved
  -- с неизвестной рукой можно отклонить или дополнить, но нельзя тихо переапрувнуть без стороны.
  if new.board = 'dynamometer' and new.hand is null and (
    tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and new.status = 'approved'
      and (
        old.status is distinct from new.status
        or old.board is distinct from new.board
        or old.hand is distinct from new.hand
      )
    )
  ) then
    raise exception 'dynamometer_hand_required';
  end if;
  if new.board = 'gripper' and new.hand is not null then
    raise exception 'gripper_hand_not_allowed';
  end if;
  return new;
end;
$$;

revoke execute on function public.leaderboard_validate_hand() from public, anon, authenticated;

drop trigger if exists leaderboard_hand_required on public.leaderboard_entries;
create trigger leaderboard_hand_required
before insert or update of board, hand, status on public.leaderboard_entries
for each row execute function public.leaderboard_validate_hand();

create index if not exists leaderboard_dynamometer_hand_rank_idx
  on public.leaderboard_entries (dynamometer_id, hand, weight_kg desc)
  where board = 'dynamometer' and status = 'approved';

-- Новый overload для пяти представлений динамометров:
-- device_all = лучший результат на выбранном приборе независимо от руки;
-- left/right = выбранная рука; sum = лучшие L+R на одном приборе;
-- absolute = лучший одноручный результат пользователя среди всех приборов.
create function public.get_leaderboard(
  p_board text,
  p_dynamometer_code text,
  p_set_type text,
  p_dynamometer_view text
)
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
  bodyweight       numeric,
  dynamometer_code text,
  dynamometer      text,
  hand             text,
  weight_kg        numeric,
  left_weight_kg   numeric,
  right_weight_kg  numeric,
  gripper_brand    text,
  gripper_name     text,
  gripper_rgc      numeric,
  gripper_rgc_unit text,
  set_type         text,
  certified        boolean,
  video_url        text,
  left_video_url   text,
  right_video_url  text,
  performed_at     date,
  verified_at      timestamptz,
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_board is null or p_board not in ('dynamometer', 'gripper') then
    raise exception 'bad_board';
  end if;

  if p_board = 'gripper' then
    return query
      select e.id, e.user_id,
             coalesce(p.display_name, 'Athlete'), p.avatar, p.bodyweight,
             null::text, null::text, null::text,
             null::numeric, null::numeric, null::numeric,
             g.brand, g.name, g.rgc, g.rgc_unit,
             e.set_type, e.certified, e.video_url,
             null::text, null::text,
             e.performed_at, e.verified_at, e.created_at
      from public.leaderboard_entries e
      left join public.profile p on p.user_id = e.user_id
      left join public.grippers g on g.id = e.gripper_id
      where e.status = 'approved'
        and e.board = 'gripper'
        and (p_set_type is null or e.set_type = p_set_type)
      order by g.rgc desc nulls last, e.verified_at desc
      limit 500;
    return;
  end if;

  if p_dynamometer_view is null
     or p_dynamometer_view not in ('device_all', 'left', 'right', 'sum', 'absolute') then
    raise exception 'bad_dynamometer_view';
  end if;
  if p_dynamometer_view <> 'absolute' and p_dynamometer_code is null then
    raise exception 'dynamometer_category_required';
  end if;

  if p_dynamometer_view = 'sum' then
    return query
      with ranked as (
        select e.*,
               row_number() over (
                 partition by e.user_id, e.dynamometer_id, e.hand
                 order by e.weight_kg desc, e.verified_at desc, e.id
               ) as rn
        from public.leaderboard_entries e
        join public.dynamometers d on d.id = e.dynamometer_id
        where e.status = 'approved'
          and e.board = 'dynamometer'
          and e.hand in ('left', 'right')
          and d.code = p_dynamometer_code
      ), pairs as (
        select l.user_id, l.dynamometer_id,
               l.id as left_id, r.id as right_id,
               l.weight_kg as left_kg, r.weight_kg as right_kg,
               l.video_url as left_url, r.video_url as right_url,
               greatest(l.performed_at, r.performed_at) as performed,
               greatest(l.verified_at, r.verified_at) as verified,
               greatest(l.created_at, r.created_at) as created
        from ranked l
        join ranked r
          on r.user_id = l.user_id
         and r.dynamometer_id = l.dynamometer_id
         and r.hand = 'right'
         and r.rn = 1
        where l.hand = 'left' and l.rn = 1
      )
      select x.left_id, x.user_id,
             coalesce(p.display_name, 'Athlete'), p.avatar, p.bodyweight,
             d.code, d.name, null::text,
             x.left_kg + x.right_kg, x.left_kg, x.right_kg,
             null::text, null::text, null::numeric, null::text,
             null::text, false, x.left_url,
             x.left_url, x.right_url,
             x.performed, x.verified, x.created
      from pairs x
      left join public.profile p on p.user_id = x.user_id
      join public.dynamometers d on d.id = x.dynamometer_id
      order by (x.left_kg + x.right_kg) desc, x.verified desc
      limit 500;
    return;
  end if;

  return query
    select q.id, q.user_id, q.display_name, q.avatar, q.bodyweight,
           q.dynamometer_code, q.dynamometer, q.hand, q.weight_kg,
           null::numeric, null::numeric,
           null::text, null::text, null::numeric, null::text,
           null::text, false, q.video_url,
           null::text, null::text,
           q.performed_at, q.verified_at, q.created_at
    from (
      select distinct on (e.user_id)
             e.id, e.user_id,
             coalesce(p.display_name, 'Athlete') as display_name,
             p.avatar, p.bodyweight,
             d.code as dynamometer_code, d.name as dynamometer,
             e.hand, e.weight_kg, e.video_url,
             e.performed_at, e.verified_at, e.created_at
      from public.leaderboard_entries e
      left join public.profile p on p.user_id = e.user_id
      join public.dynamometers d on d.id = e.dynamometer_id
      where e.status = 'approved'
        and e.board = 'dynamometer'
        and (p_dynamometer_view = 'absolute' or d.code = p_dynamometer_code)
        and (p_dynamometer_view not in ('left', 'right') or e.hand = p_dynamometer_view)
      order by e.user_id, e.weight_kg desc, e.verified_at desc, e.id
    ) q
    order by q.weight_kg desc, q.verified_at desc
    limit 500;
end;
$$;

revoke execute on function public.get_leaderboard(text, text, text, text) from public, anon;
grant execute on function public.get_leaderboard(text, text, text, text) to authenticated;

-- Рука должна быть видна модератору до решения.
drop function if exists public.get_leaderboard_pending();
create function public.get_leaderboard_pending()
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
  board            text,
  dynamometer      text,
  hand             text,
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
           e.board, d.name, e.hand, e.weight_kg,
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

revoke execute on function public.get_leaderboard_pending() from public, anon;
grant execute on function public.get_leaderboard_pending() to authenticated;

do $$
begin
  if exists (
    select 1 from public.leaderboard_entries
    where board = 'dynamometer' and status = 'pending' and hand is null
  ) then
    raise exception 'pending dynamometer entries require hand resolution before migration';
  end if;
  if exists (
    select 1 from public.leaderboard_entries
    where board = 'gripper' and hand is not null
  ) then
    raise exception 'gripper hand invariant failed';
  end if;
end;
$$;
