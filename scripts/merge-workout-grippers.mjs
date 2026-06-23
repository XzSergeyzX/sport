// Сливает раздробленные гриппер-упражнения ВНУТРИ одной тренировки (по дате DATE, по умолч. 2026-06-16)
// в ОДНО «Стиснення еспандера» с N подходами. Каждый подход уже несёт свой gripper_id/set_type в meta —
// при слиянии только перецепляем sets.workout_exercise_id на якорь, meta не трогаем → потерь нет.
// Трогает ТОЛЬКО упражнения с log_kind='gripper'. Остальное (вис, кисть и т.п.) — не касается.
//
// Сухой прогон (по умолчанию): печатает план. Применить: node scripts/merge-workout-grippers.mjs --apply
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const DATE = process.env.DATE || '2026-06-16';
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const KEY_FILE = join(dirname(fileURLToPath(import.meta.url)), '.service-role-key');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : undefined);
if (!KEY) {
  console.error('✗ Нет ключа: задай $env:SUPABASE_SERVICE_ROLE_KEY или положи его в scripts/.service-role-key');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const me = users.users.find((u) => (u.email ?? '').includes('gonenko1995'));

const { data: workouts } = await db
  .from('workouts').select('id, started_at, title').eq('user_id', me.id);
const day = (workouts ?? []).filter((w) => (w.started_at ?? '').slice(0, 10) === DATE);

let movedTotal = 0;
let mergedWE = 0;
for (const w of day) {
  const { data: wes } = await db
    .from('workout_exercises')
    .select('id, exercise_id, display_name, order_index, exercises(log_kind)')
    .eq('workout_id', w.id)
    .order('order_index', { ascending: true });

  // только гриппер-упражнения, в порядке; первое — якорь, остальные вливаем в него
  const grippers = (wes ?? []).filter((we) => we.exercises?.log_kind === 'gripper');
  if (grippers.length <= 1) {
    console.log(`  [${w.started_at.slice(0, 10)}] гриппер-упражнений: ${grippers.length} → сливать нечего`);
    continue;
  }
  const anchor = grippers[0];
  console.log(`  [${w.started_at.slice(0, 10)}] якорь WE${anchor.order_index} "${anchor.display_name}" ← вливаю ${grippers.length - 1} упр.`);
  for (const we of grippers.slice(1)) {
    const { data: sets } = await db.from('sets').select('id').eq('workout_exercise_id', we.id);
    const n = (sets ?? []).length;
    console.log(`      ← WE${we.order_index} "${we.display_name}" (${n} подх) → перецепляю на якорь, упражнение удаляю`);
    movedTotal += n;
    mergedWE++;
    if (APPLY) {
      for (const s of sets ?? []) await db.from('sets').update({ workout_exercise_id: anchor.id }).eq('id', s.id);
      await db.from('workout_exercises').delete().eq('id', we.id);
    }
  }
}
console.log(`\n${APPLY ? 'СЛИТО' : 'БУДЕТ СЛИТО'}: ${mergedWE} упр (${movedTotal} подх перецеплено)${APPLY ? '' : '  (запусти с --apply)'}`);
