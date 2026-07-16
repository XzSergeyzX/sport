-- P0: продуктовые роли и целостность активной тренировки.
-- RLS уже включён на всех затронутых таблицах; политики ниже только сужают доступ.
-- Данных не удаляем и схему пользовательских строк не меняем.
-- Перед prod push: node scripts/preflight-private-access.mjs (роли + активные дубли).

-- Миграция должна остановиться до CREATE INDEX, если в проде уже есть дубли активных
-- тренировок: автоматически завершать реальные тренировки пользователя небезопасно.
do $$
begin
  if exists (
    select 1
    from public.workouts
    where ended_at is null
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'multiple_active_workouts_exist: resolve duplicates before applying migration';
  end if;
end
$$;

create unique index if not exists workouts_one_active_per_user_uidx
  on public.workouts (user_id)
  where ended_at is null;

-- Private Programs: только явно выданные full/admin. service_role по-прежнему обходит RLS.
drop policy if exists programs_all on public.programs;
create policy programs_private_all on public.programs for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  );

drop policy if exists program_blocks_all on public.program_blocks;
create policy program_blocks_private_all on public.program_blocks for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  );

drop policy if exists program_exercises_all on public.program_exercises;
create policy program_exercises_private_all on public.program_exercises for all
  using (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.programs p
      where p.id = program_id and p.user_id = auth.uid()
    )
  );

drop policy if exists program_sets_all on public.program_sets;
create policy program_sets_private_all on public.program_sets for all
  using (
    exists (
      select 1
      from public.program_exercises pe
      join public.programs p on p.id = pe.program_id
      where pe.id = program_exercise_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.program_exercises pe
      join public.programs p on p.id = pe.program_id
      where pe.id = program_exercise_id and p.user_id = auth.uid()
    )
  );

-- Private health/cycle/coach data. grip видит только community-контур.
drop policy if exists health_all on public.health_snapshots;
create policy health_private_all on public.health_snapshots for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  );

drop policy if exists cycle_periods_all on public.cycle_periods;
create policy cycle_periods_private_all on public.cycle_periods for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  );

drop policy if exists coach_facts_all on public.coach_facts;
create policy coach_facts_private_all on public.coach_facts for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  );

drop policy if exists ai_threads_all on public.ai_threads;
create policy ai_threads_private_all on public.ai_threads for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.user_roles r
      where r.user_id = auth.uid() and r.role in ('full', 'admin')
    )
  );

drop policy if exists ai_messages_all on public.ai_messages;
create policy ai_messages_private_all on public.ai_messages for all
  using (
    exists (
      select 1 from public.ai_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ai_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );
