-- Ревизия каталога (день-27): unilateral-флаг + переименования/переводы + чистка.
-- Сгенерировано из правок пользователя в catalog-review.xlsx.

alter table public.exercises add column if not exists unilateral boolean not null default false;

-- односторонние (есть выбор стороны): эвристика (grip/one-arm/wrist) + явные отметки «двохстороннім»
update public.exercises set unilateral = true where id in (
  '7eb20562-23bf-404d-99d6-067397a6b4d4',
  '69086bea-c285-4462-a264-37b20d4174ec',
  'a282a54e-b392-4e23-804b-3017175af5bb',
  'ecd0d84d-3c23-441a-8c77-40982f45dbb7',
  '23519914-f519-4625-8749-21b5926160b4',
  'f1075517-ba75-4615-9eb7-2cd4e9058f42',
  '2cb3d468-ad0c-447d-b00b-7a23033483c4',
  'ae2e2451-b28a-4cf9-a311-eb3a379013dd',
  '27d786bb-5e8e-44ce-9ca0-887ab67491f5',
  '34a1fec3-f12e-4d89-85b2-ac6c912fb914',
  '368e0719-5862-4013-87b7-a6e1ae7e7486',
  '05feab23-45f0-4dcb-8eb6-590a3bdda575',
  '481effc6-0dd3-44e6-9fb4-28bcf8ce1d66',
  '5faca6f7-7a25-424c-ace0-70575c325617',
  '8305b525-2ce6-4ea9-9b69-bd4cb09f05e0',
  '866cdce0-f08a-4cca-8cc8-98f3396e6fb2',
  '2f7102aa-96cb-4b28-9f1b-5a6e56602190',
  '5d6480ad-dfed-49e3-b189-c69536b07b6b',
  'c4498ff1-d40a-4d0e-a6ba-9b693947d369',
  '9c5d556e-c140-4be5-9a43-5315639176e9',
  '49b837c4-aeae-47d0-bd09-aa93e992f965',
  '22aaa6b0-d708-41ef-a203-ad3ad65d9db0',
  '3b658992-1485-4d0e-80ac-9b5fb8f37ab5',
  '327e7e0f-0b6e-4bcf-a0e7-19ef2e39eb39',
  'c554485e-b8e4-433e-8058-5d4d198b412e',
  'c29efb43-fbd7-4fff-9bc2-356652aa5aa4',
  'dfdd93a5-102c-436b-aa9b-56d9bd3a2f40',
  '03ea5d85-df42-4920-850a-e4c3f605f4a8',
  'ec42340c-0365-4ccd-ad4b-dd46ea9b4f70',
  'd082408a-abf4-4e3f-a4bb-8863172faf41'
);

-- переименования / переводы (без веса/мусора в названиях)
update public.exercises set name_uk = 'Вис на перекладині', name_en = 'Dead Hang' where id = '788b6566-aa88-4c0e-8238-c7978cca8f5a';
update public.exercises set name_uk = 'Негативні підтягування', name_en = 'Negative Pull-up' where id = '22e5ceb5-131f-4442-a028-e612d3e50317';
update public.exercises set name_uk = 'Млин з гирею', name_en = 'Kettlebell Windmill' where id = '2ba5ab5e-112e-4527-86bd-70feb1696e34';
update public.exercises set name_uk = 'Оберти млинця', name_en = 'Plate Rotations' where id = '32c6c4a3-deb0-45a9-af73-83aa1b22b89c';
update public.exercises set name_uk = 'Розгинання рук на тріцепс з гантелею', name_en = 'Seated Dumbbell Triceps Extension' where id = 'f07c524b-d524-4126-8d61-0ddee947ced7';
update public.exercises set name_uk = 'Підтягування на одній руці', name_en = 'One-arm Pull-up' where id = 'd082408a-abf4-4e3f-a4bb-8863172faf41';
update public.exercises set name_uk = 'Жим штанги стоячи + швунг', name_en = 'Standing Barbell Press + Push Press' where id = '9573b234-e9c6-4246-9a9f-7ea920ff61dc';
update public.exercises set name_uk = 'Негативні відтискання', name_en = 'Negative Push-up' where id = '2968958b-4f23-4531-ba9d-be91f8c584c7';
update public.exercises set name_uk = 'Провал у лопатках в планці', name_en = 'Scapular Depression in Plank' where id = '96113f65-1c96-451f-b6a5-52c472ecf308';
update public.exercises set name_uk = 'Проворот резинки', name_en = 'Band Rotation' where id = 'a6f01e15-8abc-43ee-ba06-1ff25bf83300';
update public.exercises set name_uk = 'Розводка гантелей в сторони', name_en = 'Dumbbell Lateral Raise' where id = 'd7902615-1b62-4c40-945b-609427c4bf82';
update public.exercises set name_uk = 'Розводка резинки', name_en = 'Band Pull-apart' where id = '7e18cd3c-5a6c-43ac-8f91-78164e610cde';
update public.exercises set name_uk = 'Утримання над головою', name_en = 'Overhead Hold' where id = 'd78d17f9-6158-4625-9459-483704033b91';
update public.exercises set name_uk = 'Утримання нижнього положення відтискання з колін', name_en = 'Bottom Push-up Hold (knees)' where id = 'a4078c46-3ba7-48f1-ab89-1ba2d5e7c2e9';
update public.exercises set name_uk = 'Добре розігрій плечі', name_en = 'Warm up shoulders well' where id = '5575728f-0f05-4450-a7ee-31732724cc82';

-- удаление мусора (только если не используется в тренировках/программах/рекордах)
delete from public.exercises e where e.id in (
  'af8a4435-d06b-4a23-a2c8-adf3dbbd7a80',
  '1c2b461c-eef3-472b-bd6a-00e977cf0800',
  '9b9bf803-d091-4e68-9598-b0e2c95e0b99',
  'c3c8e760-914b-4665-9743-6052721a97be'
)
  and not exists (select 1 from public.workout_exercises we where we.exercise_id = e.id)
  and not exists (select 1 from public.program_exercises pe where pe.exercise_id = e.id)
  and not exists (select 1 from public.personal_records pr where pr.exercise_id = e.id);
