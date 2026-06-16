-- Пол в профиле (для отслеживания цикла и будущей аналитики по фазам).
-- Прогрессивно: male / female / other / na (+ свободный gender_self для «інше»).
alter table public.profile
  add column if not exists gender text
    check (gender is null or gender in ('male', 'female', 'other', 'na')),
  add column if not exists gender_self text;
