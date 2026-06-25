-- Лёгкая сводка по тренировкам для списка на главном экране.
-- Зачем: список тянул полную вложенность (workout_exercises → sets) ради подсчёта тоннажа/объёма
-- на клиенте и потому был ограничен 30 записями. Агрегаты считаем в SQL (правило проекта — метрики
-- в SQL/RPC, не на клиенте) → строка сводки крошечная, можно показывать все тренировки без обрезки.
--
-- RLS: это VIEW, не таблица. security_invoker=true → RLS базовых таблиц (workouts/workout_exercises/
-- sets) применяется к ВЫЗЫВАЮЩЕМУ пользователю, поэтому отдельная политика на вью не нужна и юзер
-- видит только свои строки. Агрегатная логика 1:1 повторяет workoutStats() в src/lib/db/workouts.ts:
-- считаем только выполненные подходы (logged_at не null); «обидві» (meta.side='both') → объём ×2.
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
    sum(coalesce(s.weight, 0) * coalesce(s.reps, 0) * (case when s.meta->>'side' = 'both' then 2 else 1 end))
      filter (where s.logged_at is not null),
    0
  ) as tonnage
from public.workouts w
left join public.workout_exercises we on we.workout_id = w.id
left join public.sets s on s.workout_exercise_id = we.id
group by w.id;

grant select on public.workout_summaries to authenticated;
