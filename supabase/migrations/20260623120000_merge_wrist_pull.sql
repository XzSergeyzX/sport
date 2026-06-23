-- «Натяжка з нижнього блока» и «Натяжка через кисть» — одно движение (флексия кисти на блоке).
-- Раньше были заведены как два разных ГЛОБАЛЬНЫХ каталожных упражнения
-- (см. 20260619140000_catalog_wrist_pull — там их ошибочно развели). Пользователь подтвердил: это дубль.
-- Сливаем: перецепляем ВСЕ ссылки «з нижнього блока» → «через кисть», переносим алиасы, удаляем дубль.
-- Перецепка глобальная (иначе FK с RESTRICT не дадут удалить запись каталога); на практике натяжку
-- логирует только один аккаунт. Деструктив согласован явно.

do $$
declare
  dst uuid;
  src uuid;
begin
  -- каноническое упражнение, в которое всё сливаем
  select id into dst from public.exercises
  where name_uk = 'Натяжка через кисть' and is_global
  order by created_at nulls last
  limit 1;

  if dst is null then
    raise exception 'merge_wrist_pull: target «Натяжка через кисть» missing — apply 20260619140000_catalog_wrist_pull first';
  end if;

  -- все дубли с именем «Натяжка з нижнього блока» (обычно один глобальный) → перецепить и удалить
  for src in
    select id from public.exercises where name_uk = 'Натяжка з нижнього блока' and id <> dst
  loop
    update public.workout_exercises set exercise_id = dst where exercise_id = src;
    update public.program_exercises  set exercise_id = dst where exercise_id = src;
    update public.personal_records   set exercise_id = dst where exercise_id = src;
    delete from public.exercises where id = src;
    raise notice 'merge_wrist_pull: merged % into %', src, dst;
  end loop;

  -- сохранить формулировки «нижнього блока» как алиасы канонического — чтобы поиск/импорт их узнавали
  update public.exercises
  set aliases = array(
    select distinct unnest(
      coalesce(aliases, '{}') || array[
        'натяжка з нижнього блока', 'з нижнього блока', 'нижній блок',
        'натяжка с нижнего блока', 'с нижнего блока', 'нижний блок'
      ]
    )
  )
  where id = dst;
end $$;
