-- Роли доступа (комьюнити-режим): 'full' — вся апка (мы двое), 'grip' — грип-режим без ИИ
-- (дефолт для новых регистраций), 'admin' — full + модерация лидерборда.
-- НЕ колонка в profile: у юзера есть UPDATE-политика на свою строку профиля — роль там
-- он выдал бы себе сам одним PATCH. Отдельная таблица без клиентских write-политик.

create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'grip' check (role in ('grip', 'full', 'admin')),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- юзер читает свою роль (клиент по ней показывает/прячет фичи); пишет только service_role
create policy user_roles_select on public.user_roles for select using (user_id = auth.uid());

-- существующие аккаунты (наши + тестовые) — full; дальше повышение только руками/скриптом
insert into public.user_roles (user_id, role)
select id, 'full' from auth.users
on conflict (user_id) do nothing;

-- владелец — админ (модерация лидерборда)
update public.user_roles ur
set role = 'admin', updated_at = now()
from auth.users u
where u.id = ur.user_id and u.email = 'gonenko1995@gmail.com';

-- новорег: профиль + роль grip (дефолт комьюнити)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', null))
  on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'grip')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
