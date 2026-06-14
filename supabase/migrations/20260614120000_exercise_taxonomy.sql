-- Таксономия каталога упражнений (см. docs/SPEC.md §3.1):
--   cluster  — крупная группа для группировки в пикере: upper | lower | full | core
--   category — «школа» движения (показывается в скобках): general(ЗФП) | weightlifting |
--              gymnastics | crossfit | armwrestling | kettlebell
-- Локализация подписей (en/uk) — на клиенте через i18n, в БД храним стабильные коды.
-- Поля nullable: пользовательские упражнения могут быть без таксономии до её указания.

alter table public.exercises
  add column if not exists cluster  text,
  add column if not exists category text;

alter table public.exercises
  drop constraint if exists exercises_cluster_chk,
  drop constraint if exists exercises_category_chk;

alter table public.exercises
  add constraint exercises_cluster_chk
    check (cluster is null or cluster in ('upper', 'lower', 'full', 'core')),
  add constraint exercises_category_chk
    check (category is null or category in
      ('general', 'weightlifting', 'gymnastics', 'crossfit', 'armwrestling', 'kettlebell'));

-- для группировки/сортировки пикера
create index if not exists exercises_cluster_idx on public.exercises (cluster, category);
