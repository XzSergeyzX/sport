-- Аватарка профиля: ключ выбранного пресета. Сами картинки бандлятся в
-- assets/avatars/, реестр ключей — в src/lib/avatars.ts. NULL = дефолтный
-- кружок с инициалами. RLS на public.profile уже включён (init), это просто
-- добавление nullable-колонки — недеструктивно.
alter table public.profile add column if not exists avatar text;
