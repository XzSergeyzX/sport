-- Лидерборды грип-комьюнити: два борда — динамометры и эспандеры.
-- Верификация: заявка со ссылкой на видео-пруф → pending → апрув админом (review-RPC).
-- Видео НЕ храним (правило проекта) — только https-URL (YouTube/Instagram и т.п.).

-- ---------- катируемые динамометры ----------
-- Справочник, а не check-константа: новая модель добавляется строкой, без миграции схемы.
create table if not exists public.dynamometers (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0
);

alter table public.dynamometers enable row level security;
create policy dynamometers_select on public.dynamometers for select using (auth.uid() is not null);

insert into public.dynamometers (code, name, sort_order) values
  ('gm150', 'GM-150', 1),   -- любая версия GM-150
  ('xf300', 'XF-300', 2),
  ('gd',    'GD',     3)
on conflict (code) do nothing;

-- ---------- заявки на лидерборд ----------
create table if not exists public.leaderboard_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  board          text not null check (board in ('dynamometer', 'gripper')),
  -- динамометр: результат канонично в кг (ввод в lb пересчитывает клиент, как везде)
  dynamometer_id uuid references public.dynamometers (id),
  weight_kg      numeric check (weight_kg is null or (weight_kg > 0 and weight_kg < 400)),
  -- эспандер: катируются только закрытия tns / card / deep (сет-типы как в sets.meta)
  gripper_id     uuid references public.grippers (id),
  set_type       text check (set_type in ('tns', 'card', 'deep')),
  video_url      text not null check (video_url ~ '^https://' and length(video_url) <= 300),
  note           text check (note is null or length(note) <= 300),
  performed_at   date,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  verified_by    uuid references auth.users (id),
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  -- форма записи строго соответствует борду
  constraint leaderboard_entry_shape check (
    (board = 'dynamometer' and dynamometer_id is not null and weight_kg is not null
       and gripper_id is null and set_type is null)
    or
    (board = 'gripper' and gripper_id is not null and set_type is not null
       and dynamometer_id is null and weight_kg is null)
  )
);
create index if not exists leaderboard_board_idx on public.leaderboard_entries (board, status);
create index if not exists leaderboard_user_idx on public.leaderboard_entries (user_id, created_at desc);

alter table public.leaderboard_entries enable row level security;

-- свои заявки видны всегда (в т.ч. pending/rejected — статус в UI)
create policy lb_select_own on public.leaderboard_entries for select
  using (user_id = auth.uid());
-- админ видит всё (модерация)
create policy lb_select_admin on public.leaderboard_entries for select
  using (exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin'));
-- подача: только своя, только pending, поля модерации пустые
create policy lb_insert_own on public.leaderboard_entries for insert
  with check (user_id = auth.uid() and status = 'pending' and verified_by is null and verified_at is null);
-- правка: только своя и только пока pending (после решения строку меняет только модерация)
create policy lb_update_own on public.leaderboard_entries for update
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'pending' and verified_by is null);
-- отзыв своей заявки (в любом статусе — право убрать свой результат с борда)
create policy lb_delete_own on public.leaderboard_entries for delete
  using (user_id = auth.uid());

-- ---------- анти-спам: не более 5 заявок за 24 часа ----------
create or replace function public.leaderboard_entry_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.leaderboard_entries
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'daily_entry_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists leaderboard_quota on public.leaderboard_entries;
create trigger leaderboard_quota before insert on public.leaderboard_entries
  for each row execute function public.leaderboard_entry_quota();

-- ---------- публичная витрина: только approved + контролируемые поля профиля ----------
-- security definer — единственное окно, через которое чужие результаты видны наружу:
-- имя/аватар/железка/результат. Email и прочий профиль не выходят никогда.
create or replace function public.get_leaderboard(p_board text)
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
         e.set_type, e.video_url, e.performed_at, e.verified_at
  from public.leaderboard_entries e
  left join public.profile p on p.user_id = e.user_id
  left join public.dynamometers d on d.id = e.dynamometer_id
  left join public.grippers g on g.id = e.gripper_id
  where e.status = 'approved' and e.board = p_board
  order by e.weight_kg desc nulls last, e.verified_at desc
  limit 500;
$$;

revoke execute on function public.get_leaderboard(text) from anon;

-- ---------- модерация (только admin) ----------
create or replace function public.review_leaderboard_entry(p_entry uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from public.user_roles where user_id = caller and role = 'admin'
  ) then
    raise exception 'not_admin';
  end if;
  if p_action not in ('approved', 'rejected', 'pending') then
    raise exception 'bad_action';
  end if;
  update public.leaderboard_entries
  set status      = p_action,
      verified_by = case when p_action = 'pending' then null else caller end,
      verified_at = case when p_action = 'pending' then null else now() end
  where id = p_entry;
end;
$$;

revoke execute on function public.review_leaderboard_entry(uuid, text) from anon;
