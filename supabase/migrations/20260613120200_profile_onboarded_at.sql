-- Отметка прохождения онбординга — чтобы он был привязан к аккаунту и
-- синкался между устройствами (а не хранился локально на каждом).
alter table public.profile add column if not exists onboarded_at timestamptz;
