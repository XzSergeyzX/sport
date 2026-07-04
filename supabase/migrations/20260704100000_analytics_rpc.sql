-- Аналитика → SQL RPC (хвост аудита дня-46). Раньше клиент качал ВСЮ историю сетов
-- (getLoggedSets, пагинация по 1000) и агрегировал в JS, а кэш запросов целиком персистится
-- в AsyncStorage (лимит ~6МБ Android) — на росте истории это и трафик, и переполнение стораджа.
-- Теперь все метрики считаются здесь (правило проекта: метрики в SQL, не на клиенте/не ИИ),
-- клиент получает компактную сводку: агрегаты по тренировкам + готовые топы рекордов.
--
-- Семантика 1-в-1 с прежним клиентским analyze() (analytics.tsx):
-- - тоннаж: только «чистые» силовые подходы (без статики) — reps есть, duration нет, гриппер нет;
--   вес = weight + вес_тела для bodyweight_load-упражнений; side='both' → ×2;
-- - рекорды вес×повторы: дедуп по (упражнение, вес, повторы) — самая ранняя дата; топ-5 по о'Коннору
--   (reps<=1 → сам вес); грипперы исключены;
-- - рекорды времени: дедуп по (упражнение, сек, вес) — самая ранняя дата; топ-5: вес desc, сек desc;
-- - грип-рекорды: подходы с meta.gripper_id; топ-3 на вид установки (set_type) по оценке
--   RGC×(1+0.025×повторы), RGC в кг (lb-замеренные конвертируются).
-- Часовой пояс устройства серверу неизвестен → started_at/ended_at отдаём как есть,
-- календарные ymd и длительность клиент считает сам (по-прежнему).

create or replace function public.get_analytics_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with ls as (
  -- все залогированные подходы текущего юзера + контекст упражнения/тренировки
  select
    s.weight, s.reps, s.duration_sec, s.rpe,
    (s.meta->>'gripper_id')                          as gripper_id,
    coalesce(nullif(s.meta->>'set_type', ''), 'none') as set_type,
    coalesce((s.meta->>'cheat')::boolean, false)      as cheat,
    case when s.meta->>'side' = 'both' then 2 else 1 end as vol_mult,
    we.exercise_id, we.display_name,
    e.name_en, e.name_uk, e.cluster,
    coalesce(e.bodyweight_load, false) as bodyweight_load,
    w.id as workout_id, w.started_at, w.ended_at
  from public.sets s
  join public.workout_exercises we on we.id = s.workout_exercise_id
  join public.workouts w on w.id = we.workout_id
  left join public.exercises e on e.id = we.exercise_id
  where w.user_id = auth.uid() and s.logged_at is not null
),
bw as (
  select coalesce((select bodyweight from public.profile where user_id = auth.uid()), 0) as kg
),
wk as (
  select
    workout_id,
    min(started_at) as started_at,
    min(ended_at)   as ended_at,
    count(*)::int   as set_count,
    avg(rpe)        as avg_rpe,
    sum(
      case when gripper_id is null and duration_sec is null and reps is not null
                and (weight is not null or bodyweight_load)
        then (coalesce(weight, 0) + case when bodyweight_load then (select kg from bw) else 0 end)
             * reps * vol_mult
        else 0 end
    ) as tonnage
  from ls
  group by workout_id
),
-- одно имя на упражнение (display_name — от самого свежего подхода)
ex_names as (
  select distinct on (exercise_id)
    exercise_id, name_en, name_uk, cluster, display_name
  from ls
  order by exercise_id, started_at desc
),
rep_base as (
  -- дедуп одинаковых результатов (вес × повторы) — остаётся самая ранняя дата
  select distinct on (exercise_id, weight, reps)
    exercise_id, weight, reps, cheat, started_at,
    case when reps <= 1 then weight else weight * (1 + 0.025 * reps) end as one_rm
  from ls
  where gripper_id is null and weight is not null and reps is not null
  order by exercise_id, weight, reps, started_at asc
),
rep_rank as (
  select *, row_number() over (partition by exercise_id order by one_rm desc) as rn
  from rep_base
),
time_base as (
  select distinct on (exercise_id, duration_sec, weight)
    exercise_id, duration_sec, weight, cheat, started_at
  from ls
  where duration_sec is not null
    and not (gripper_id is not null and reps is not null)
  order by exercise_id, duration_sec, weight, started_at asc
),
time_rank as (
  select *,
    row_number() over (
      partition by exercise_id order by coalesce(weight, 0) desc, duration_sec desc
    ) as rn
  from time_base
),
grip_base as (
  select distinct on (set_type, gripper_id, reps)
    set_type, gripper_id, reps, started_at
  from ls
  where gripper_id is not null and reps is not null
  order by set_type, gripper_id, reps, started_at asc
),
grip_est as (
  select gb.set_type, gb.reps, gb.started_at,
    g.name as gripper_name,
    case when g.rgc is null then null
         when g.rgc_unit = 'lb' then g.rgc * 0.453592
         else g.rgc end as rgc_kg
  from grip_base gb
  left join public.grippers g on g.id::text = gb.gripper_id
),
grip_rank as (
  select *,
    case when rgc_kg is null then null
         when reps <= 1 then rgc_kg
         else rgc_kg * (1 + 0.025 * reps) end as est_kg,
    row_number() over (
      partition by set_type
      order by coalesce(
        case when rgc_kg is null then null
             when reps <= 1 then rgc_kg
             else rgc_kg * (1 + 0.025 * reps) end, -1) desc,
        reps desc
    ) as rn
  from grip_est
)
select jsonb_build_object(
  'workouts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', workout_id, 'started_at', started_at, 'ended_at', ended_at,
      'set_count', set_count, 'avg_rpe', avg_rpe, 'tonnage', tonnage
    ) order by started_at)
    from wk
  ), '[]'::jsonb),
  'rep_records', coalesce((
    select jsonb_agg(jsonb_build_object(
      'exercise_id', r.exercise_id,
      'name_en', n.name_en, 'name_uk', n.name_uk,
      'display_name', n.display_name, 'cluster', n.cluster,
      'weight', r.weight, 'reps', r.reps, 'one_rm', r.one_rm,
      'date', r.started_at, 'cheat', r.cheat
    ) order by r.exercise_id, r.rn)
    from rep_rank r left join ex_names n on n.exercise_id = r.exercise_id
    where r.rn <= 5
  ), '[]'::jsonb),
  'time_records', coalesce((
    select jsonb_agg(jsonb_build_object(
      'exercise_id', tr.exercise_id,
      'name_en', n.name_en, 'name_uk', n.name_uk,
      'display_name', n.display_name, 'cluster', n.cluster,
      'sec', tr.duration_sec, 'weight', tr.weight,
      'date', tr.started_at, 'cheat', tr.cheat
    ) order by tr.exercise_id, tr.rn)
    from time_rank tr left join ex_names n on n.exercise_id = tr.exercise_id
    where tr.rn <= 5
  ), '[]'::jsonb),
  'grip_records', coalesce((
    select jsonb_agg(jsonb_build_object(
      'set_type', set_type, 'gripper_name', gripper_name,
      'rgc_kg', rgc_kg, 'est_kg', est_kg, 'reps', reps, 'date', started_at
    ) order by set_type, rn)
    from grip_rank
    where rn <= 3
  ), '[]'::jsonb)
);
$$;

-- только залогиненные: функция скоупится auth.uid(), анониму делать нечего
revoke execute on function public.get_analytics_summary() from anon;
grant execute on function public.get_analytics_summary() to authenticated;

-- индексы из аудита дня-46: коуч (get_exercise_history) ищет по exercise_id без индекса;
-- partial по logged_at ускоряет выборки «только залогированные» (аналитика/сводки)
create index if not exists workout_exercises_exercise_idx on public.workout_exercises (exercise_id);
create index if not exists sets_logged_idx on public.sets (logged_at) where logged_at is not null;
