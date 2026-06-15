-- Архитектура «база + словники дисциплін» + новый словник «сила хвата» (grip).
-- См. docs/SPEC.md и docs/CATALOG_REVIEW.md.

-- 1) Новая дисциплина-категория grip (сила хвата) — расширяем CHECK по категориям.
alter table public.exercises drop constraint if exists exercises_category_chk;
alter table public.exercises
  add constraint exercises_category_chk
    check (category is null or category in
      ('general', 'weightlifting', 'gymnastics', 'crossfit', 'armwrestling', 'kettlebell', 'grip'));

-- 2) Базовость: is_base=true → упражнение видно всем, независимо от включённых дисциплин.
--    Специфика (армрестлінг, важка атл., гирьовий, сила хвата…) — только тем, кто включил.
alter table public.exercises add column if not exists is_base boolean not null default false;

-- 2b) Спец-форма логирования: null = обычная (вес/повтори/час). 'gripper' = поля эспандера
--     (выбор эспандера + вид установки), сохраняются в sets.meta.
alter table public.exercises add column if not exists log_kind text;

-- 3) Включённые пользователем дисциплины (коды категорий-словників). База видна всегда.
alter table public.profile add column if not exists disciplines text[] not null default '{}';

-- 4) Структурные доп-поля подхода — под специфику дисциплины (эспандер/RGC/установка и т.п.),
--    чтобы не плодить колонки в core. Обычные подходы meta не используют.
alter table public.sets         add column if not exists meta jsonb;
alter table public.program_sets add column if not exists meta jsonb;

-- 5) Эспандеры пользователя (для словника «сила хвата»): имя + RGC.
--    Отдельная сущность, чтобы вести прогресс по конкретному эспандеру.
create table if not exists public.grippers (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  rgc        numeric,                       -- замеренная нагрузка (если измеряли)
  rgc_unit   text not null default 'kg',    -- 'kg' | 'lb' — как замерили
  created_at timestamptz not null default now()
);
alter table public.grippers enable row level security;
create policy grippers_all on public.grippers for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
