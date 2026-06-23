// Удаляет ВСЕ тренировки пользователя, КРОМЕ тех, что в дату KEEP_DATE (по умолчанию 2026-06-16).
// Нужен, чтобы снести кривые старые импорты перед чистой повторной заливкой.
//
// Сухой прогон (по умолчанию): печатает, что останется и что удалится, ничего не трогает.
// Применить:  $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/purge-workouts-except.mjs --apply
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const KEEP_DATE = process.env.KEEP_DATE || '2026-06-16'; // дату-исключение можно переопределить
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
if (!me) {
  console.error('✗ Юзер gonenko1995 не найден.');
  process.exit(1);
}

const { data: workouts } = await db
  .from('workouts')
  .select('id, started_at, title')
  .eq('user_id', me.id)
  .order('started_at', { ascending: true });

const keep = [];
const drop = [];
for (const w of workouts ?? []) {
  (((w.started_at ?? '').slice(0, 10) === KEEP_DATE) ? keep : drop).push(w);
}

// сводка по числу упражнений/подходов для наглядности
async function counts(wid) {
  const { data: wes } = await db.from('workout_exercises').select('id').eq('workout_id', wid);
  const ids = (wes ?? []).map((x) => x.id);
  let setN = 0;
  if (ids.length) {
    const { count } = await db.from('sets').select('id', { count: 'exact', head: true }).in('workout_exercise_id', ids);
    setN = count ?? 0;
  }
  return { ex: ids.length, sets: setN, ids };
}

console.log(`Юзер: ${me.email}   KEEP_DATE: ${KEEP_DATE}\n${'='.repeat(60)}`);
console.log(`\nОСТАЁТСЯ (${keep.length}):`);
for (const w of keep) {
  const c = await counts(w.id);
  console.log(`  ✓ ${w.started_at.slice(0, 10)}  "${w.title ?? '—'}"  (${c.ex} упр, ${c.sets} подх)`);
}
console.log(`\nУДАЛИТСЯ (${drop.length}):`);
let delTotal = 0;
for (const w of drop) {
  const c = await counts(w.id);
  console.log(`  ✗ ${w.started_at.slice(0, 10)}  "${w.title ?? '—'}"  (${c.ex} упр, ${c.sets} подх)`);
  delTotal++;
  if (APPLY) {
    if (c.ids.length) {
      await db.from('sets').delete().in('workout_exercise_id', c.ids);
      await db.from('workout_exercises').delete().eq('workout_id', w.id);
    }
    await db.from('workouts').delete().eq('id', w.id);
  }
}
console.log(`\n${'='.repeat(60)}`);
console.log(APPLY ? `УДАЛЕНО тренировок: ${delTotal}` : `БУДЕТ УДАЛЕНО: ${delTotal}  (запусти с --apply для применения)`);
