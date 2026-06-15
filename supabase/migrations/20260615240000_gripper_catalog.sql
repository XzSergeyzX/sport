-- Глобальный каталог эспандеров (Cannon Powerworks RGC chart, значения AVERAGE в lb).
-- Видят все; личные эспандеры пользователя (owner_id) — в приоритете сверху в выборе.

-- 1) Расширяем таблицу: бренд/линейка + глобальность; owner_id становится nullable (для глобальных).
alter table public.grippers add column if not exists brand text;
alter table public.grippers add column if not exists is_global boolean not null default false;
alter table public.grippers alter column owner_id drop not null;

-- 2) RLS: глобальные видят все; писать/править/удалять можно только свои (не глобальные).
drop policy if exists grippers_all on public.grippers;
create policy grippers_select on public.grippers for select
  using (is_global or owner_id = auth.uid());
create policy grippers_insert on public.grippers for insert
  with check (owner_id = auth.uid() and is_global = false);
create policy grippers_update on public.grippers for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and is_global = false);
create policy grippers_delete on public.grippers for delete
  using (owner_id = auth.uid());

-- 3) Идемпотентность сидов — уникальность (бренд+обозначение) среди глобальных.
create unique index if not exists grippers_global_uidx on public.grippers (brand, name) where is_global;

-- 4) Сид каталога (значения в фунтах). owner_id = null, is_global = true.
insert into public.grippers (name, brand, rgc, rgc_unit, is_global)
select v.name, v.brand, v.rgc, 'lb', true
from (values
  -- Captains of Crush (IronMind)
  ('Guide', 'CoC', 27), ('Sport', 'CoC', 37), ('Trainer', 'CoC', 54),
  ('#0.5', 'CoC', 66), ('#1', 'CoC', 75), ('#1.5', 'CoC', 85),
  ('#2', 'CoC', 103), ('#2.5', 'CoC', 125), ('#3', 'CoC', 148),
  ('#3.5', 'CoC', 176), ('#4', 'CoC', 213),
  -- Tetting
  ('Beginner', 'Tetting', 53), ('Advanced', 'Tetting', 78), ('Super Advanced', 'Tetting', 85),
  ('Master', 'Tetting', 107), ('Super Master', 'Tetting', 126), ('Grand Master', 'Tetting', 146),
  ('Elite', 'Tetting', 170), ('Super Elite', 'Tetting', 195), ('Grand Elite', 'Tetting', 203),
  ('Pro', 'Tetting', 252), ('World Class', 'Tetting', 275),
  -- Standard
  ('Sn', 'Standard', 51), ('Zn', 'Standard', 60), ('Ag', 'Standard', 83), ('Au', 'Standard', 95),
  ('Cu', 'Standard', 106), ('Pt', 'Standard', 116), ('Fe', 'Standard', 136), ('Ni', 'Standard', 152),
  ('Co', 'Standard', 162), ('Ti (1st gen)', 'Standard', 176), ('Ti (pinned)', 'Standard', 179),
  ('W', 'Standard', 194), ('Cr', 'Standard', 236),
  -- Grip Genie
  ('1', 'Grip Genie', 48), ('2', 'Grip Genie', 65), ('3', 'Grip Genie', 90), ('4', 'Grip Genie', 114),
  ('5', 'Grip Genie', 147), ('6', 'Grip Genie', 179), ('7', 'Grip Genie', 208),
  -- RB (includes Spectrum)
  ('70', 'RB', 43), ('100', 'RB', 56), ('130', 'RB', 76), ('160', 'RB', 97), ('180', 'RB', 107),
  ('210', 'RB', 123), ('240', 'RB', 136), ('250', 'RB', 144), ('260', 'RB', 137),
  ('240N', 'RB', 122), ('260N', 'RB', 124), ('280N', 'RB', 134), ('300N', 'RB', 147),
  ('330N', 'RB', 158), ('365N', 'RB', 183), ('300', 'RB', 177), ('330', 'RB', 180),
  ('365', 'RB', 227), ('400', 'RB', 224),
  -- GHP
  ('1', 'GHP', 43), ('2', 'GHP', 60), ('3', 'GHP', 72), ('4', 'GHP', 92), ('5', 'GHP', 111),
  ('6', 'GHP', 130), ('7', 'GHP', 147), ('8', 'GHP', 173), ('9', 'GHP', 210), ('10', 'GHP', 259),
  -- Mash Monster
  ('1', 'Mash Monster', 157), ('2', 'Mash Monster', 164), ('3', 'Mash Monster', 180),
  ('4', 'Mash Monster', 186), ('5', 'Mash Monster', 184), ('6', 'Mash Monster', 189),
  ('7', 'Mash Monster', 196), ('8', 'Mash Monster', 201),
  -- Heavy Grips
  ('100', 'Heavy Grips', 46), ('150', 'Heavy Grips', 61), ('200', 'Heavy Grips', 88),
  ('250', 'Heavy Grips', 114), ('300', 'Heavy Grips', 144), ('350', 'Heavy Grips', 179),
  -- Hybrid
  ('Beginner', 'Hybrid', 58), ('Advanced', 'Hybrid', 77), ('Super Adv.', 'Hybrid', 86),
  ('Master', 'Hybrid', 110), ('Grand Master', 'Hybrid', 147), ('Elite', 'Hybrid', 172),
  -- Left-Turn
  ('Trainer', 'Left-Turn', 53), ('#1', 'Left-Turn', 73), ('#2', 'Left-Turn', 104), ('#3', 'Left-Turn', 150),
  -- CPW Hybrid
  ('100', 'CPW Hybrid', 60), ('130', 'CPW Hybrid', 82), ('160', 'CPW Hybrid', 99),
  ('180', 'CPW Hybrid', 114), ('210', 'CPW Hybrid', 129), ('240', 'CPW Hybrid', 143),
  ('300', 'CPW Hybrid', 184), ('365', 'CPW Hybrid', 194)
) as v(name, brand, rgc)
on conflict (brand, name) where is_global do update set
  rgc = excluded.rgc,
  rgc_unit = excluded.rgc_unit;
