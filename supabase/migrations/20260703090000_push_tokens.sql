-- Expo push-токены устройств (EAS этап 2, BACKLOG §9). Пишет клиент за себя (upsert
-- при старте), читает только edge-функция push-entry-review сервис-ролью.
-- PK (user_id, token): один телефон с двумя акками = две строки — пуш уйдёт на устройство
-- даже если там сейчас другой акк (контент не чувствительный, для 2 тестеров это фича).
create table public.push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy pt_select_own on public.push_tokens
  for select using (auth.uid() = user_id);
create policy pt_insert_own on public.push_tokens
  for insert with check (auth.uid() = user_id);
create policy pt_update_own on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy pt_delete_own on public.push_tokens
  for delete using (auth.uid() = user_id);
