-- Вес тела в тоннаже для «весо-телесных» упражнений (см. docs/SPEC.md §3.7).
-- Зачем: подтягивания и т.п. логируются с weight=null → давали 0 тоннажа. Для упражнений, где
-- атлет реально поднимает всё тело, нагрузка/повтор = вес_тела (profile.bodyweight) + доп.отягощение.
--
-- Флаг bodyweight_load (а не equipment='bodyweight'), потому что:
--   • equipment='bodyweight' включает отжимания/пресс/планку — там НЕ полный вес тела (раздуло бы);
--   • Ring Dip — полный вес тела, но equipment='rings'.
-- «Честные» = подтягивания (вкл. с резинкой/негативные/одноручные), брусья/кольца, пистолет, канат.

alter table public.exercises add column if not exists bodyweight_load boolean not null default false;

update public.exercises set bodyweight_load = true
where name_en in (
        'Pull-up', 'Assisted Pull-up', 'Negative Pull-up', 'Pistol Squat', 'Rope Climb', 'Ring Dip'
      )
   or name_en ilike '%pull-up%' or name_en ilike '%pull up%'
   or name_en ilike '%muscle-up%' or name_en ilike '%muscle up%'
   or name_uk ilike '%підтягув%' or name_uk ilike '%мускл%' or name_uk ilike '%брус%';

-- Пересборка вью сводки: тоннаж теперь по эффективной нагрузке (доп.вес + вес тела для bodyweight_load).
-- Доп. join к exercises (флаг) и profile (вес тела владельца). security_invoker=true → RLS базовых
-- таблиц (вкл. profile/exercises) применяется к вызывающему: видит свой вес и свой+глобальный каталог.
-- Кардинальность не меняется: exercises 1:1 через we.exercise_id, profile 1:1 через w.user_id.
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
    sum(
      (coalesce(s.weight, 0) + (case when e.bodyweight_load then coalesce(p.bodyweight, 0) else 0 end))
      * coalesce(s.reps, 0)
      * (case when s.meta->>'side' = 'both' then 2 else 1 end)
    ) filter (where s.logged_at is not null),
    0
  ) as tonnage
from public.workouts w
left join public.workout_exercises we on we.workout_id = w.id
left join public.sets s on s.workout_exercise_id = we.id
left join public.exercises e on e.id = we.exercise_id
left join public.profile p on p.user_id = w.user_id
group by w.id;

grant select on public.workout_summaries to authenticated;
