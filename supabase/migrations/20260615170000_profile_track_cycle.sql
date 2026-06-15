-- Отслеживание цикла — опция профиля (по умолчанию выключено).
-- Карточка цикла во вкладке Здоров'я показывается только при track_cycle = true.
alter table public.profile
  add column if not exists track_cycle boolean not null default false;
