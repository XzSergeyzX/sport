// Сидер трёх программ для Сергея (по его команде, день-54):
//   A. Підтягування — хвиля 9 тижнів (адаптация ППН 1.2 из xlsx)
//   B. Натяжка: піраміда + статика + бок + пронація (его тяжёлый день, композиция из логов)
//   C. Гиря + еспандери (его день гири + діп-сет пирамида)
// SERVICE ROLE. --dry — только напечатать план. --clean — удалить ранее насеянные (по title).
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const SERGEY = 'a80ddd8a-5b9d-4023-972b-c8b74d03c48b';
const DRY = process.argv.includes('--dry');
const CLEAN = process.argv.includes('--clean');

// упражнения (ids из каталога, сверены по его тренировкам)
const EX = {
  pullup: '1bebbd04-e56a-44b5-bee7-3be915a63c2c', // Підтягування
  natKist: '6a1a26e7-843f-4485-8519-09f754694abf', // Натяжка через кисть
  natVidv: 'f1075517-ba75-4615-9eb7-2cd4e9058f42', // Натяжка через відведення
  bik: 'e0cdbe8d-d193-4a46-8583-007cddf4b434', // Бічний натиск
  pron: 'cd1e013e-930e-4b83-9bed-d4060685a203', // Пронація
  shvung: 'c4498ff1-d40a-4d0e-a6ba-9b693947d369', // Швунг гирі
  ryvok: 'b6e05904-e71e-4ccf-aaf5-0e444ed9ceac', // Ривок гирі з підлоги
  gripper: 'dfdd93a5-102c-436b-aa9b-56d9bd3a2f40', // Стиснення еспандера
};

// эспандеры: берём ровно те id, что он логировал (уточняются из его sets перед вставкой)
const GRIP_NAMES = {
  hg200: 'Heavy Grips 200 (Temu)',
  hg250: 'Heavy Grips 250 (filed)',
  coc25: 'CoC #2.5',
  coc3: 'CoC #3',
  hg300g: 'Heavy Grips 300 (Gods of Grip)',
};

const r = (reps, extra = {}) => ({ target_reps: reps, ...extra });
const w = (weight, reps, extra = {}) => ({ target_reps: reps, target_weight: weight, ...extra });
const hold = (weight, sec, side) => ({
  target_weight: weight,
  target_duration_sec: sec,
  meta: { side },
});
const both = { meta: { side: 'both' } };

function programs(grip) {
  const g = (id, reps, note) => ({
    target_reps: reps,
    meta: { gripper_id: id, set_type: 'deep' },
    ...(note ? { notes: note } : {}),
  });
  return [
    {
      title: 'Підтягування — хвиля 9 тижнів (ППН 1.2)',
      notes:
        'Адаптація ППН 1.2: 3 дні/тиждень, хвильова періодизація, тест на 9-му тижні. Підходи нижче = тиждень 1; прогрес по тижнях — у нотатках вправ.',
      exercises: [
        {
          exercise_id: EX.pullup,
          name: 'Драбини — День 1',
          notes:
            'Легка інтенсивність (7-9ПМ: резина або власна вага). Тижні: Т1 2·3·5 / Т2 2·3·5·2·3 / Т3 2·3·5·2·3·5·2·3 / Т4 2·3·5·2·3·4 / Т5 2·3·5·2·3·5·2·1 / Т6 2·3·5·2·3·5·2·3·2·2 / Т7 2·3·5·2·3·3 / Т8 2·3·5·2·1 / Т9 2·2·2 → тест',
          sets: [r(2), r(3), r(5)],
        },
        {
          exercise_id: EX.pullup,
          name: 'Драбини + важкі сингли — День 2',
          notes:
            'Об’єм + сингли з вагою твого 1-3ПМ (у файлі 15 кг — підправ). Тижні: Т1 2·3·2 +сингл / Т2 2·3·5 +2 сингли / Т3 2·3·5 +сингл +2·3·2 +сингл / Т4 2·3·5 +сингл +2·2 / Т5 2·3·5 +сингл +2·3·2 / Т6 2·3·5 +2 сингли +2·3·5 +сингл / Т7 2·3·5 +2 сингли +2 / Т8 2·3 +сингл +3 / Т9 тест: макс повтори зі старим 7-9ПМ або новий 1ПМ',
          sets: [r(2), r(3), r(2), w(15, 1, { notes: 'важкий сингл' })],
        },
        {
          exercise_id: EX.pullup,
          name: 'Довга драбина — День 3',
          notes:
            'Тижні: Т1 2·3·5·2·1 / Т2 2·3·5·2·3·2·2 / Т3 2·3·5·2·3·5·2·3·5·1 / Т4 2·3·5·2·3·5·2·3 / Т5 2·3·5·2·3·5·2·3·5 / Т6 2·3·5·2·3·5·2·3·5·2·3·1 / Т7 2·3·5·2·3·5·2·1 / Т8 2·3·5·2·3·1 / Т9 тест',
          sets: [r(2), r(3), r(5), r(2), r(1)],
        },
      ],
    },
    {
      title: 'Натяжка: піраміда + статика + бок + пронація',
      notes: 'Твій важкий день натяжки — композиція з логів 14.05–24.06.',
      exercises: [
        {
          exercise_id: EX.natKist,
          name: 'Натяжка через кисть — піраміда',
          notes: 'Верх піраміди 24.06: 36 кг × 6 на RPE9.',
          sets: [w(16, 15, both), w(22, 12, both), w(26, 10, both), w(32, 6, both), w(36, 6, both)],
        },
        {
          exercise_id: EX.natKist,
          name: 'Натяжка — статика по боках',
          notes: 'Як 10.05/14.05: 28 кг, 22–26 с на кожну сторону.',
          sets: [hold(28, 24, 'right'), hold(28, 24, 'left'), hold(28, 22, 'right'), hold(28, 22, 'left')],
        },
        {
          exercise_id: EX.natVidv,
          name: 'Натяжка через відведення — трійки',
          sets: [w(22.5, 3, both), w(26.5, 3, both), w(32.5, 3, both)],
        },
        {
          exercise_id: EX.bik,
          name: 'Бічний натиск',
          sets: [w(16, 15, both), w(16, 12, both)],
        },
        {
          exercise_id: EX.pron,
          name: 'Пронація',
          notes: 'У заминці — концентрична робота з резиною на пронацію.',
          sets: [w(16, 12, both), w(21, 8, both), w(26, 6, both)],
        },
      ],
    },
    {
      title: 'Гиря + еспандери (сингли + діп-сет)',
      notes: 'Твій день гирі + еспандерна піраміда — композиція з логів 21.06–05.07.',
      exercises: [
        {
          exercise_id: EX.shvung,
          name: 'Швунг гирі — розгін до синглу',
          notes: '05.07 дійшов до 60×1 і 60×3 правою.',
          sets: [
            w(24, 6, both),
            w(32, 6, { meta: { side: 'right' } }),
            w(40, 3, { meta: { side: 'right' } }),
            w(48, 2, { meta: { side: 'right' } }),
            w(60, 1, { meta: { side: 'right' } }),
          ],
        },
        {
          exercise_id: EX.ryvok,
          name: 'Ривок гирі з підлоги',
          sets: [
            w(24, 2, { meta: { side: 'left' } }),
            w(24, 2, { meta: { side: 'right' } }),
            w(32, 3, { meta: { side: 'left' } }),
            w(32, 3, { meta: { side: 'right' } }),
            w(40, 2, { meta: { side: 'left' } }),
            w(40, 2, { meta: { side: 'right' } }),
          ],
        },
        {
          exercise_id: EX.gripper,
          name: 'Стиснення еспандера — діп-сет піраміда',
          notes: 'Як 27.06: розгін → спроба CoC #3 → бек-оф.',
          sets: [
            g(grip.hg200, 8),
            g(grip.hg250, 4),
            g(grip.coc25, 4),
            g(grip.coc3, 1, 'спроба закриття'),
            g(grip.hg300g, 5, 'бек-оф'),
          ],
        },
      ],
    },
  ];
}

// — какие точно id эспандеров он логировал (среди дублей имён берём использованный) —
async function resolveGrippers() {
  const { data: ws } = await db.from('workouts').select('id').eq('user_id', SERGEY);
  const { data: wes } = await db
    .from('workout_exercises')
    .select('id')
    .in('workout_id', ws.map((x) => x.id));
  const { data: sets } = await db
    .from('sets')
    .select('meta')
    .in('workout_exercise_id', wes.map((x) => x.id))
    .not('meta', 'is', null);
  const used = new Map(); // gripper_id -> count
  for (const s of sets) {
    const gid = s.meta?.gripper_id;
    if (gid) used.set(gid, (used.get(gid) ?? 0) + 1);
  }
  const { data: grips } = await db.from('grippers').select('id, name, owner_id');
  const byKey = {};
  for (const [key, name] of Object.entries(GRIP_NAMES)) {
    const candidates = grips.filter((x) => x.name === name && (x.owner_id === SERGEY || x.owner_id == null));
    candidates.sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0));
    if (!candidates.length) throw new Error(`эспандер не найден: ${name}`);
    byKey[key] = candidates[0].id;
    console.log(`  ${key} = ${name} → ${candidates[0].id} (использован ${used.get(candidates[0].id) ?? 0}×)`);
  }
  return byKey;
}

const TITLES = [
  'Підтягування — хвиля 9 тижнів (ППН 1.2)',
  'Натяжка: піраміда + статика + бок + пронація',
  'Гиря + еспандери (сингли + діп-сет)',
];

if (CLEAN) {
  const { data: del, error } = await db
    .from('programs')
    .delete()
    .eq('user_id', SERGEY)
    .in('title', TITLES)
    .select('id, title');
  if (error) throw error;
  console.log('удалено:', del.map((p) => p.title));
  process.exit(0);
}

console.log('эспандеры:');
const grip = await resolveGrippers();
const plan = programs(grip);

if (DRY) {
  for (const p of plan) {
    console.log(`\n• ${p.title}`);
    for (const pe of p.exercises) console.log(`   ${pe.name}: ${pe.sets.length} подходов`);
  }
  console.log('\n(dry-run: ничего не вставлено)');
  process.exit(0);
}

// защита от дублей при повторном запуске
const { data: existing } = await db
  .from('programs')
  .select('title')
  .eq('user_id', SERGEY)
  .in('title', TITLES);
if (existing?.length) {
  console.error('уже есть:', existing.map((p) => p.title), '— сначала --clean');
  process.exit(1);
}

for (const p of plan) {
  const programId = randomUUID();
  const { error: pErr } = await db
    .from('programs')
    .insert({ id: programId, user_id: SERGEY, title: p.title, source: 'manual', notes: p.notes });
  if (pErr) throw pErr;
  let peOrder = 0;
  for (const pe of p.exercises) {
    const peId = randomUUID();
    const { error: eErr } = await db.from('program_exercises').insert({
      id: peId,
      program_id: programId,
      block_id: null,
      exercise_id: pe.exercise_id,
      name: pe.name,
      order_index: peOrder++,
      notes: pe.notes ?? null,
    });
    if (eErr) throw eErr;
    const rows = pe.sets.map((s, i) => ({
      id: randomUUID(),
      program_exercise_id: peId,
      order_index: i,
      target_reps: s.target_reps ?? null,
      target_duration_sec: s.target_duration_sec ?? null,
      target_weight: s.target_weight ?? null,
      notes: s.notes ?? null,
      meta: s.meta ?? null,
    }));
    const { error: sErr } = await db.from('program_sets').insert(rows);
    if (sErr) throw sErr;
  }
  console.log(`✓ ${p.title} (${p.exercises.length} вправ)`);
}
console.log('готово');
