-- Долг «формула тоннажа в 3 местах» (START HERE): вью workout_summaries и RPC analytics_summary_for
-- считали тоннаж каждый своим выражением — при изменении правил надо было править оба + клиент.
-- Теперь ЕДИНСТВЕННЫЙ SQL-источник — функция set_tonnage(); вью и RPC пересажены на неё.
--
-- Клиентская копия остаётся ОСОЗНАННО (офлайн-мгновенная сводка, offline-first):
-- src/lib/db/workouts.ts → workoutStats(). Меняешь правило здесь → меняй и там (перекрёстные комменты).
--
-- Выравнивание семантики (раньше вью и RPC чуть расходились):
--   • правило: подход даёт тоннаж ⇔ есть reps; нагрузка = доп.вес + вес тела (bodyweight_load);
--     «обидві» (meta.side='both') → ×2. Грип-сеты дают 0 сами собой (weight всегда null).
--   • RPC раньше исключал подходы, у которых reps И duration_sec заполнены одновременно
--     (UI такого не создаёт, теоретически возможно из импорта) — теперь, как вью и клиент,
--     считает их по reps. Вью — без изменений в числах.

-- ---------- 1. каноническая формула тоннажа одного подхода ----------
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
    else (coalesce(p_weight, 0)
          + case when coalesce(p_bodyweight_load, false) then coalesce(p_bodyweight, 0) else 0 end)
         * p_reps
         * (case when p_meta->>'side' = 'both' then 2 else 1 end)
  end;
$$;

-- чистая математика (не definer, таблиц не читает), но гранты по паттерну дня-49:
-- revoke from public + явные. authenticated нужен вью (security_invoker), service_role — серверным RPC.
revoke execute on function public.set_tonnage(numeric, integer, jsonb, boolean, numeric) from public, anon;
grant execute on function public.set_tonnage(numeric, integer, jsonb, boolean, numeric) to authenticated, service_role;

-- ---------- 2. вью сводок — тоннаж через set_tonnage() (числа не меняются) ----------
create or replace view public.workout_summaries
with (security_invoker = true) as
select
  w.id,
  w.user_id,
  w.started_at,
  w.ended_at,
  w.title,
  w.notes,
  count(distinct s.workout_exercise_id) filter (where s.logged_at is not null) as exercise_count,
  count(s.id) filter (where s.logged_at is not null) as set_count,
  coalesce(
    sum(coalesce(s.reps, 0) * (case when s.meta->>'side' = 'both' then 2 else 1 end))
      filter (where s.logged_at is not null),
    0
  ) as rep_count,
  coalesce(
    sum(coalesce(s.duration_sec, 0) * (case when s.meta->>'side' = 'both' then 2 else 1 end))
      filter (where s.logged_at is not null),
    0
  ) as hold_sec,
  coalesce(
    sum(public.set_tonnage(s.weight, s.reps, s.meta, e.bodyweight_load, p.bodyweight))
      filter (where s.logged_at is not null),
    0
  ) as tonnage
from public.workouts w
left join public.workout_exercises we on we.workout_id = w.id
left join public.sets s on s.workout_exercise_id = we.id
left join public.exercises e on e.id = we.exercise_id
left join public.profile p on p.user_id = w.user_id
group by w.id;

grant select on public.workout_summaries to authenticated;

-- ---------- 3. RPC сводки — тот же set_tonnage() в wk; остальное тело без изменений ----------
-- create or replace сохраняет ACL (локдаун 20260704120000: только service_role) — гранты не трогаем.
create or replace function public.analytics_summary_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with ls as (
  select
    s.weight, s.reps, s.duration_sec, s.rpe, s.meta,
    (s.meta->>'gripper_id')                          as gripper_id,
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
bw as (
  select coalesce((select bodyweight from public.profile where user_id = p_user), 0) as kg
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
rep_base as (
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
