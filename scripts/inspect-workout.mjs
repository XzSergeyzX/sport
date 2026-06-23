// READ-ONLY. Печатает полную структуру тренировки за дату (по умолчанию 2026-06-16):
// упражнения (с exercise_id / log_kind / display_name) и все подходы с meta.
// Нужен, чтобы УВИДЕТЬ, как раздроблены сжатия эспандера, прежде чем точечно сливать. Ничего не меняет.
//
// Запуск:  $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/inspect-workout.mjs
//   (другая дата)  $env:DATE="2026-05-16"; node scripts/inspect-workout.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATE = process.env.DATE || '2026-06-16';
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
// Ключ: из env, иначе из gitignored scripts/.service-role-key (чтобы не мучить кавычки в консоли)
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
  .from('workouts')
  .select('id, started_at, title')
  .eq('user_id', me.id);
const day = (workouts ?? []).filter((w) => (w.started_at ?? '').slice(0, 10) === DATE);

if (!day.length) {
  console.log(`Тренировок за ${DATE} не найдено.`);
  process.exit(0);
}

// карта грипперов для расшифровки meta.gripper_id
const { data: grips } = await db.from('grippers').select('id, brand, name, rgc, rgc_unit');
const gripName = (id) => {
  const g = (grips ?? []).find((x) => x.id === id);
  return g ? `${g.brand ? g.brand + ' ' : ''}${g.name} (${g.rgc}${g.rgc_unit})` : `?${(id ?? '').slice(0, 8)}`;
};

for (const w of day) {
  console.log(`\n=== ${w.started_at.slice(0, 10)}  "${w.title ?? '—'}"  (${w.id}) ===`);
  const { data: wes } = await db
    .from('workout_exercises')
    .select('id, exercise_id, display_name, order_index, block_key, block_type, exercises(name_uk, name_en, log_kind)')
    .eq('workout_id', w.id)
    .order('order_index', { ascending: true });

  for (const we of wes ?? []) {
    const ex = we.exercises ?? {};
    const lk = ex.log_kind ? ` [log_kind=${ex.log_kind}]` : '';
    console.log(`\n  • WE ${we.order_index}: "${we.display_name ?? ex.name_uk ?? '—'}"  ex_id=${(we.exercise_id ?? '').slice(0, 8)}${lk}  block=${we.block_type ?? '—'}`);
    const { data: sets } = await db
      .from('sets')
      .select('id, weight, reps, duration_sec, rpe, meta')
      .eq('workout_exercise_id', we.id)
      .order('logged_at', { ascending: true });
    for (const s of sets ?? []) {
      const m = s.meta ?? {};
      const parts = [];
      if (s.weight != null) parts.push(`${s.weight}кг`);
      if (s.reps != null) parts.push(`×${s.reps}`);
      if (s.duration_sec != null) parts.push(`${s.duration_sec}с`);
      if (m.gripper_id) parts.push(`gripper=${gripName(m.gripper_id)}`);
      if (m.set_type) parts.push(`set_type=${m.set_type}`);
      if (m.side) parts.push(`side=${m.side}`);
      if (m.cheat) parts.push('cheat');
      console.log(`      - ${parts.join(' ') || '(пусто)'}`);
    }
  }
}
console.log(`\n(read-only, ничего не изменено)`);
