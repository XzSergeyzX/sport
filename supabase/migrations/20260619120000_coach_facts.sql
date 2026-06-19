-- ІІ-коуч (§3): долговременная память об атлете. Чат переиспользует ai_threads/ai_messages.
-- coach_facts — структурные заметки, которые коуч читает и дописывает инструментом remember_fact:
-- цели, травмы/ограничения, предпочтения, индивидуальные особенности, прошлые выводы.
create table if not exists public.coach_facts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'note'
             check (kind in ('goal', 'injury', 'constraint', 'preference', 'note')),
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists coach_facts_user_idx on public.coach_facts (user_id, created_at desc);

alter table public.coach_facts enable row level security;

-- юзер видит/правит свои факты; пишет их и сервер (service_role обходит RLS из edge-функции)
create policy coach_facts_all on public.coach_facts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
