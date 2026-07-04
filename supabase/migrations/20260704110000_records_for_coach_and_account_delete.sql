-- Хвосты аудита дня-46 (продолжение дня-48):
-- 1) personal_records «реализовать-или-выкинуть» → ВЫКИНУТЬ: таблица пуста (0 строк на проде,
--    проверено), никто не пишет. Рекорды коуча теперь считаются из sets той же логикой, что
--    аналитика: get_analytics_summary() обобщена в analytics_summary_for(p_user) — одна
--    реализация метрик на оба потребителя (экран аналитики и тул коуча get_records).
-- 2) delete_account() — удаление аккаунта самим юзером (требование Play Store, этап 4 §9).
--    Каскады: все пользовательские таблицы ссылаются на auth.users on delete cascade;
--    единственное исключение — leaderboard_entries.verified_by (без каскада, блокировал бы
--    удаление админа-модератора) → переводим на set null: апрувнутые заявки переживают
--    уход модератора.

-- ---------- 1а. приватная параметризованная сводка (только service_role) ----------
create or replace function public.analytics_summary_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with ls as (
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

-- только сервер (тул коуча через service_role); клиентам — обёртка ниже
revoke execute on function public.analytics_summary_for(uuid) from anon, authenticated;

-- ---------- 1б. клиентская обёртка = та же сводка по auth.uid() ----------
create or replace function public.get_analytics_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.analytics_summary_for(auth.uid());
$$;

revoke execute on function public.get_analytics_summary() from anon;
grant execute on function public.get_analytics_summary() to authenticated;

-- ---------- 1в. personal_records — выкинута (пуста, никто не пишет; тул коуча переведён) ----------
drop table if exists public.personal_records;

-- ---------- 2а. verified_by переживает удаление модератора ----------
alter table public.leaderboard_entries
  drop constraint if exists leaderboard_entries_verified_by_fkey;
alter table public.leaderboard_entries
  add constraint leaderboard_entries_verified_by_fkey
  foreign key (verified_by) references auth.users (id) on delete set null;

-- ---------- 2б. удаление аккаунта самим юзером (Play Store, этап 4 §9) ----------
-- Каскадом уходят profile/workouts/sets/programs/oura/cycle/ai_threads(+messages)/ai_usage/
-- coach_facts/user_roles/leaderboard_entries/push_tokens и кастомные exercises/grippers.
-- Файлов в Storage у юзера нет (правило проекта: исходники не храним).
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_account() from anon;
grant execute on function public.delete_account() to authenticated;
