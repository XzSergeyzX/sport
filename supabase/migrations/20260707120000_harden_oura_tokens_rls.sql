-- Аудит (день-50): defense-in-depth на private.oura_tokens.
-- Таблица лежит в схеме private, НЕ экспонированной в PostgREST → сейчас клиентские роли
-- (anon/authenticated) до неё и так не дотягиваются. Но это защита «одним тумблером»: стоит
-- кому-то добавить private в exposed schemas (Settings → API) — и OURA access-токены станут
-- читаемы по публичному ключу. RLS без единой политики = deny-all для всех ролей, КРОМЕ
-- service_role (он RLS обходит) — то есть get/store_oura_token (definer, под service_role)
-- продолжают работать без изменений, а любой прямой доступ клиента закрыт на уровне строк.
alter table private.oura_tokens enable row level security;
