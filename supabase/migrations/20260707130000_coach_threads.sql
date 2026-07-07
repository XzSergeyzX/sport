-- Коуч-треды (§3, хвост дня-31): несколько разговоров на пользователя вместо одного.
-- ai_threads уже RLS-защищён (owner-scoped, init.sql). Добавляем метаданные для списка тредов:
--   title      — краткий заголовок (сервер ставит из первого сообщения юзера при создании);
--   updated_at — время последней активности (сервер бампит на каждое сообщение) → сортировка списка.
alter table public.ai_threads
  add column if not exists title      text,
  add column if not exists updated_at timestamptz not null default now();

-- добавление NOT NULL DEFAULT now() проставило существующим тредам now(); возвращаем им
-- реальное время создания, иначе список сортировался бы так, будто все обновлены только что.
update public.ai_threads set updated_at = created_at;

-- список тредов юзера читается по свежести
create index if not exists ai_threads_user_updated_idx
  on public.ai_threads (user_id, updated_at desc);
