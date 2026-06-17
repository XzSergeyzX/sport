// Одноразовый сидер МОК-тренировок — чтобы посмотреть, как рисуются Аналітика/кореляції,
// пока реальных тренировок нет. Работает на SERVICE ROLE (в обход RLS).
//
// Запуск (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"; node scripts/seed-mock-workouts.mjs
// Очистка (снести всё, что насидели):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/seed-mock-workouts.mjs --clean
//
// Service role key: Supabase Dashboard → Project Settings → API → service_role (secret).
// Цель — аккаунт с наибольшим числом health_snapshots (= с подключённой OURA), чтобы
// тренировки сшивались с readiness/сном по датам. Переопределить: --user <uuid>.
//
// Все тренировки помечаются notes='mock-seed' → --clean удаляет ровно их (каскадом).

import { createClient } from '@supabase/supabase-js';

const URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://sdvegejubjmmlnifvigt.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MARK = 'mock-seed';

if (!KEY) {
  console.error('✗ Нет SUPABASE_SERVICE_ROLE_KEY в окружении. См. шапку файла.');
  process.exit(1);
}

const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const userArg = args[args.indexOf('--user') + 1];
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const ymd = (d) => d.toISOString().slice(0, 10);
const at = (date, h, m) => new Date(`${ymd(date)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`).toISOString();
const rnd = (min, max) => Math.round(min + Math.random() * (max - min));

async function targetUser() {
  if (userArg) return userArg;
  // аккаунт с наибольшим числом OURA-снимков
  const { data, error } = await db.from('health_snapshots').select('user_id').limit(5000);
  if (error) throw error;
  if (!data?.length) throw new Error('health_snapshots пуст — некого таргетить. Передай --user <uuid>.');
  const tally = {};
  for (const r of data) tally[r.user_id] = (tally[r.user_id] ?? 0) + 1;
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

async function clean(user) {
  const { data, error } = await db
    .from('workouts')
    .delete()
    .eq('user_id', user)
    .eq('notes', MARK)
    .select('id');
  if (error) throw error;
  console.log(`✓ Удалено мок-тренировок: ${data?.length ?? 0} (каскадом — упражнения и подходы).`);
}

async function pickExercises() {
  const { data, error } = await db
    .from('exercises')
    .select('id, name_uk, name_en, cluster, metric, is_base')
    .eq('is_base', true)
    .limit(60);
  if (error) throw error;
  const reps = (data ?? []).filter((e) => (e.metric ?? 'reps') === 'reps' && e.cluster);
  if (reps.length < 3) throw new Error('Мало базовых упражнений с кластером для мока.');
  // 4 разных кластера по возможности
  const seen = new Set();
  const pick = [];
  for (const e of reps) {
    if (pick.length >= 4) break;
    if (seen.has(e.cluster)) continue;
    seen.add(e.cluster);
    pick.push(e);
  }
  while (pick.length < 4 && reps[pick.length]) pick.push(reps[pick.length]);
  return pick;
}

async function seed(user) {
  const ex = await pickExercises();
  console.log('Упражнения для мока:', ex.map((e) => e.name_uk).join(', '));

  const offsets = [29, 26, 23, 20, 17, 14, 11, 8, 5, 2];
  const today = new Date();
  let totalSets = 0;

  for (let k = 0; k < offsets.length; k++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offsets[k]);
    const started = at(d, 17, 30);
    const ended = at(d, 18, rnd(15, 35));
    const prog = 1 + k * 0.03; // лёгкая прогрессия по весу к свежим датам

    const { data: w, error: we } = await db
      .from('workouts')
      .insert({ user_id: user, started_at: started, ended_at: ended, title: 'Mock', notes: MARK })
      .select('id')
      .single();
    if (we) throw we;

    const useEx = [ex[k % ex.length], ex[(k + 1) % ex.length]]; // 2 упражнения на тренировку
    for (let i = 0; i < useEx.length; i++) {
      const e = useEx[i];
      const { data: wx, error: wxe } = await db
        .from('workout_exercises')
        .insert({ workout_id: w.id, exercise_id: e.id, order_index: i, display_name: e.name_uk })
        .select('id')
        .single();
      if (wxe) throw wxe;

      const baseW = Math.round((20 + i * 10) * prog);
      const rows = [];
      for (let s = 0; s < 4; s++) {
        rows.push({
          workout_exercise_id: wx.id,
          reps: rnd(6, 10),
          weight: baseW + s * 2,
          rpe: rnd(6, 9),
          logged_at: started, // ВАЖНО: без logged_at подход не попадёт в аналитику
          completed_at: started,
        });
      }
      const { error: se } = await db.from('sets').insert(rows);
      if (se) throw se;
      totalSets += rows.length;
    }
  }
  console.log(`✓ Засидено ${offsets.length} тренировок, ${totalSets} подходов за период ${ymd(new Date(today.getTime() - 29 * 864e5))} → сьогодні.`);
}

(async () => {
  const user = await targetUser();
  console.log(`Цель: user_id = ${user}`);
  await clean(user); // всегда чистим прошлый мок, чтобы не дублить
  if (!CLEAN) await seed(user);
  console.log('Готово. В приложении: Аналітика (Reload не нужен — потяни вкладку/перезайди).');
})().catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
