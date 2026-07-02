-- Realtime на leaderboard_entries: клиент подписывается на изменения СВОИХ заявок
-- (postgres_changes уважает RLS — политика lb_select_own не даст увидеть чужие),
-- чтобы показать локальную нотификацию, когда модератор апрувнул/реджектнул заявку.
-- Деструктива нет: только добавление таблицы в публикацию realtime.
alter publication supabase_realtime add table public.leaderboard_entries;
