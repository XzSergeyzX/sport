-- Дата результата в публичной витрине борда: тап по строке показывает, когда сделан
-- энтри. performed_at формой пока не заполняется (в бэклоге «дата выступления»), поэтому
-- отдаём и created_at (дату подачи) как фолбэк. Смена return table → drop до create
-- (тот же паттерн, что 20260702160000). Деструктива нет — функция пересоздаётся 1:1 + колонка.
drop function if exists public.get_leaderboard(text);
create function public.get_leaderboard(p_board text)
returns table (
  entry_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar           text,
  bodyweight       numeric,
  dynamometer      text,
  weight_kg        numeric,
  gripper_brand    text,
  gripper_name     text,
  gripper_rgc      numeric,
  gripper_rgc_unit text,
  set_type         text,
  certified        boolean,
  video_url        text,
  performed_at     date,
  verified_at      timestamptz,
  created_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.user_id,
         coalesce(p.display_name, 'Athlete'), p.avatar, p.bodyweight,
         d.name, e.weight_kg,
         g.brand, g.name, g.rgc, g.rgc_unit,
         e.set_type, e.certified, e.video_url, e.performed_at, e.verified_at, e.created_at
  from public.leaderboard_entries e
  left join public.profile p on p.user_id = e.user_id
  left join public.dynamometers d on d.id = e.dynamometer_id
  left join public.grippers g on g.id = e.gripper_id
  where e.status = 'approved' and e.board = p_board
  order by e.weight_kg desc nulls last, e.verified_at desc
  limit 500;
$$;
revoke execute on function public.get_leaderboard(text) from anon;
