-- В каталоге не было «Натяжка через кисть» (флексия) — только «через відведення» и общая
-- «з нижнього блока». Армрестлёр их чередует, это разные движения → заводим отдельно.
insert into public.exercises
  (name_en, name_uk, muscle_group, equipment, aliases, cluster, category, metric, is_base, log_kind, unilateral, is_global)
select
  'Wrist-flexion Side Pull', 'Натяжка через кисть', 'forearms', 'cable',
  array['натяжка через кисть','через кисть','натяжка кистю','натяжка кистью','wrist pull','wrist flexion pull'],
  'upper', 'armwrestling', 'reps', false, null, true, true
where not exists (select 1 from public.exercises where name_uk = 'Натяжка через кисть');
