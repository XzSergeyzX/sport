-- Рекорды силы: единая семантика нагрузки и Pareto-фронтир вместо пяти дублей по e1RM.
-- weight в sets = дополнительный вес; для bodyweight_load эффективная нагрузка = bodyweight + weight.

-- ---------- 1. Каноническая эффективная нагрузка ----------
create or replace function public.set_load(
  p_weight numeric,
  p_bodyweight_load boolean,
  p_bodyweight numeric
) returns numeric
language sql
immutable
as $$
  select case
    when p_weight is null and not coalesce(p_bodyweight_load, false) then null
    else coalesce(p_weight, 0)
       + case when coalesce(p_bodyweight_load, false) then coalesce(p_bodyweight, 0) else 0 end
  end;
$$;

revoke execute on function public.set_load(numeric, boolean, numeric) from public, anon;
grant execute on function public.set_load(numeric, boolean, numeric) to authenticated, service_role;

-- Тоннаж и PR теперь используют одну формулу нагрузки.
create or replace function public.set_tonnage(
  p_weight numeric,
  p_reps integer,
  p_meta jsonb,
  p_bodyweight_load boolean,
  p_bodyweight numeric
) returns numeric
language sql
immutable
as $$
  select case
    when p_reps is null then 0
    else coalesce(public.set_load(p_weight, p_bodyweight_load, p_bodyweight), 0)
       * p_reps
       * (case when p_meta->>'side' = 'both' then 2 else 1 end)
  end;
$$;

-- Самопроверка чистой математики во время db push.
do $$
begin
  if public.set_load(null, true, 95) <> 95
     or public.set_load(20, true, 95) <> 115
     or public.set_load(40, false, 95) <> 40
     or public.set_load(null, false, 95) is not null then
    raise exception 'set_load invariant failed';
  end if;
end;
$$;

-- До bodyweight_load (миграция 20260630120000) вес тела местами писался прямо в sets.weight.
-- Нормализуем только созданные до неё строки, где weight точно равен текущему bodyweight.
update public.sets s
set weight = null
from public.workout_exercises we
join public.workouts w on w.id = we.workout_id
join public.exercises e on e.id = we.exercise_id
join public.profile p on p.user_id = w.user_id
where s.workout_exercise_id = we.id
  and e.bodyweight_load = true
  and s.completed_at < '2026-06-30T12:00:00Z'::timestamptz
  and p.bodyweight is not null
  and s.weight = p.bodyweight
  and s.meta->>'gripper_id' is null;

-- ---------- 2. Аналитика ----------
-- create or replace сохраняет ACL: прямой вызов остаётся только у service_role.
create or replace function public.analytics_summary_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with bw as (
  select coalesce((select bodyweight from public.profile where user_id = p_user), 0) as kg
),
ls as (
  select
    s.weight, s.reps, s.duration_sec, s.rpe, s.meta,
    public.set_load(s.weight, e.bodyweight_load, (select kg from bw)) as record_weight,
    (s.meta->>'gripper_id')                           as gripper_id,
    coalesce(nullif(s.meta->>'set_type', ''), 'none') as set_type,
    coalesce((s.meta->>'cheat')::boolean, false)      as cheat,
    we.exercise_id, we.display_name,
    e.name_en, e.name_uk, e.cluster,
    coalesce(e.bodyweight_load, false) as bodyweight_load,
    w.id as workout_id, w.started_at, w.ended_at
  from public.sets s
  join public.workout_exercises we on we.id = s.workout_exercise_id
  join public.workouts w on w.id = we.workout_id
  left join public.exercises e on e.id = we.exercise_id
  where w.user_id = p_user and s.logged_at is not null
),
wk as (
  select
    workout_id,
    min(started_at) as started_at,
    min(ended_at)   as ended_at,
    count(*)::int   as set_count,
    avg(rpe)        as avg_rpe,
    sum(public.set_tonnage(weight, reps, meta, bodyweight_load, (select kg from bw))) as tonnage
  from ls
  group by workout_id
),
ex_names as (
  select distinct on (exercise_id)
    exercise_id, name_en, name_uk, cluster, display_name
  from ls
  order by exercise_id, started_at desc
),
-- Один лучший повторный результат на каждую эффективную нагрузку.
rep_best_weight as (
  select distinct on (exercise_id, record_weight)
    exercise_id, record_weight as weight, reps, cheat, started_at,
    case
      when reps <= 1 then record_weight
      else record_weight * (1 + 0.025 * reps)
    end as one_rm
  from ls
  where gripper_id is null
    and record_weight > 0
    and reps > 0
  order by exercise_id, record_weight, reps desc, started_at asc
),
-- Оставляем только недоминируемые PR: более тяжёлый вес с не меньшими повторами
-- полностью вытесняет слабую строку. 60×4 оставляет 50×5 и 40×15, но убирает 60×3/60×1.
rep_frontier as (
  select candidate.*
  from rep_best_weight candidate
  where not exists (
    select 1
    from rep_best_weight stronger
    where stronger.exercise_id = candidate.exercise_id
      and stronger.weight >= candidate.weight
      and stronger.reps >= candidate.reps
      and (stronger.weight > candidate.weight or stronger.reps > candidate.reps)
  )
),
rep_rank as (
  select *, row_number() over (
    partition by exercise_id
    order by one_rm desc, weight desc, reps desc
  ) as rn
  from rep_frontier
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
  select *, row_number() over (
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

-- Самопроверка Pareto-правила на кейсе швунга из production.
do $$
declare
  got text[];
begin
  with source(weight, reps) as (
    values (60::numeric, 4), (60, 3), (60, 1), (56, 1), (50, 5), (40, 15), (40, 13)
  ),
  best as (
    select distinct on (weight) weight, reps
    from source
    order by weight, reps desc
  ),
  frontier as (
    select candidate.*
    from best candidate
    where not exists (
      select 1 from best stronger
      where stronger.weight >= candidate.weight
        and stronger.reps >= candidate.reps
        and (stronger.weight > candidate.weight or stronger.reps > candidate.reps)
    )
  )
  select array_agg(weight::text || 'x' || reps::text order by weight desc)
  into got
  from frontier;

  if got <> array['60x4', '50x5', '40x15'] then
    raise exception 'record frontier invariant failed: %', got;
  end if;
end;
$$;
