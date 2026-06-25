// Одноразовый сидер МОК-тренировок — чтобы посмотреть, как рисуются Аналітика/кореляції,
// пока реальных тренировок нет. Работает на SERVICE ROLE (в обход RLS).
//
// Запуск (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"; node scripts/seed-mock-workouts.mjs
// Сколько тренировок (по умолчанию 100):  ... node scripts/seed-mock-workouts.mjs --count 100
// Очистка (снести всё, что насидели):     ... node scripts/seed-mock-workouts.mjs --clean
//
// Service role key: Supabase Dashboard → Project Settings → API → service_role (secret).
// Цель — аккаунт с наибольшим числом health_snapshots (= с подключённой OURA), чтобы
// тренировки сшивались с readiness/сном по датам. Переопределить: --user <uuid>.
//
// Тренировки сажаются на РЕАЛЬНЫЕ даты OURA-снимков (равномерно по всему диапазону) → корреляции
// гарантированно сшиваются. Если снимков мало — добиваем днями назад от сегодня.
// Вес растёт по ходу серии (прогрессия) с шумом.
// СТРУКТУРЫ (ротация по дню, чтобы покрыть рендер и агрегацию блоков, а не только простые пары):
//   обычные дни · суперсеты · EMOM (с интервалом/раундами) · удержания (time-метрика, hold_sec) ·
//   изредка meta.side='both' (×2 в тоннаже/объёме). См. planGroups().
// Все тренировки помечаются notes='mock-seed' → --clean удаляет ровно их (каскадом).

import { randomUUID } from 'node:crypto';

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
const userArg = args.includes('--user') ? args[args.indexOf('--user') + 1] : undefined;
const COUNT = args.includes('--count') ? Math.max(1, Number(args[args.indexOf('--count') + 1]) || 0) : 100;
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
    .select('id, name_uk, cluster, metric, is_base')
    .eq('is_base', true)
    .limit(120);
  if (error) throw error;
  const all = data ?? [];
  const repsAll = all.filter((e) => (e.metric ?? 'reps') === 'reps' && e.cluster);
  const time = all.filter((e) => e.metric === 'time'); // удержания (Планка/Хват млинця) → hold_sec
  if (repsAll.length < 4) throw new Error('Мало базовых reps-упражнений для мока.');
  // reps: сначала по одному из разных кластеров (разнообразие трендов/PR), потом добор до ~10
  const byCluster = new Map();
  for (const e of repsAll) if (!byCluster.has(e.cluster)) byCluster.set(e.cluster, e);
  const reps = [...byCluster.values()];
  for (const e of repsAll) {
    if (reps.length >= 10) break;
    if (!reps.includes(e)) reps.push(e);
  }
  return { reps, time };
}

const round25 = (x) => Math.round(x / 2.5) * 2.5;

/**
 * План тренировки = массив групп. Группа либо одиночное упражнение (block=false → своя карточка),
 * либо НАСТОЯЩИЙ кластер (суперсет/EMOM) с общим block_key. Ротация по индексу дня k гарантирует,
 * что в выборке встретятся все структуры (≈20% суперсетов, ≈20% EMOM, ≈20% удержаний/×2).
 */
function planGroups(k, pools) {
  const { reps, time } = pools;
  const R = (i) => reps[i % reps.length];
  const t = k % 5;

  if (t === 2) {
    // суперсет-день: разминочное одиночное + суперсет из 2 упражнений на 3–4 круга
    return [
      { exs: [{ ex: R(k) }] },
      { block: true, type: 'superset', label: 'Суперсет', rounds: rnd(3, 4), exs: [{ ex: R(k + 1) }, { ex: R(k + 2) }] },
    ];
  }
  if (t === 3) {
    // EMOM-день: 2–3 упражнения, интервал 60с, кругов = длит ÷ (интервал × кол-во упражнений)
    const nEx = rnd(2, 3);
    const min = [12, 16, 20][rnd(0, 2)];
    const interval = 60;
    const rounds = Math.max(4, Math.floor((min * 60) / (interval * nEx)));
    const exs = [];
    for (let j = 0; j < nEx; j++) exs.push({ ex: R(k + j) });
    return [{ block: true, type: 'emom', label: `EMOM ${min}`, rounds, intervalSec: interval, exs }];
  }
  if (t === 4 && time.length) {
    // кондиционка: силовое одиночное + удержание (time-метрика); периодически «обидві» (×2)
    return [{ exs: [{ ex: R(k) }] }, { exs: [{ ex: time[k % time.length], both: k % 11 === 0 }] }];
  }
  // обычный день: 2–3 самостоятельных упражнения подряд
  const n = rnd(2, 3);
  const groups = [];
  for (let j = 0; j < n; j++) groups.push({ exs: [{ ex: R(k + j) }] });
  return groups;
}

/** COUNT дат под тренировки: равномерно по диапазону OURA-снимков (чтобы корреляции сшивались).
 *  Если снимков меньше нужного — добиваем последовательными днями назад от самой ранней даты. */
async function pickDates(user) {
  const { data, error } = await db
    .from('health_snapshots')
    .select('date')
    .eq('user_id', user)
    .order('date', { ascending: true });
  if (error) throw error;
  const snapDates = [...new Set((data ?? []).map((r) => r.date))]; // уникальные YYYY-MM-DD, по возр.

  const dates = [];
  if (snapDates.length >= COUNT) {
    // равномерная выборка COUNT штук по всему диапазону
    const step = (snapDates.length - 1) / (COUNT - 1 || 1);
    for (let k = 0; k < COUNT; k++) dates.push(snapDates[Math.round(k * step)]);
  } else {
    dates.push(...snapDates);
    // добиваем днями назад от самой ранней даты снимков (или от сегодня, если снимков нет)
    const anchor = snapDates.length ? new Date(snapDates[0]) : new Date();
    let gap = 1;
    while (dates.length < COUNT) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - gap);
      dates.push(ymd(d));
      gap += 2; // через день
    }
    dates.sort();
  }
  return dates;
}

async function seed(user) {
  const pools = await pickExercises();
  console.log(`Пул: reps=${pools.reps.length}, time=${pools.time.length}`);

  const dates = await pickDates(user);
  console.log(`Дат под тренировки: ${dates.length} (${dates[0]} → ${dates[dates.length - 1]})`);

  const tally = { superset: 0, emom: 0, hold: 0, both: 0 };
  let totalSets = 0;
  let totalWx = 0;

  for (let k = 0; k < dates.length; k++) {
    const d = new Date(dates[k]);
    const started = at(d, 17, rnd(0, 50));
    const ended = at(d, 18, rnd(10, 55));
    const prog = 1 + (k / dates.length) * 0.35; // прогрессия по весу за всю серию (+~35% к концу)
    const noise = 0.95 + Math.random() * 0.1; // ±5% шум на тренировку

    const { data: w, error: we } = await db
      .from('workouts')
      .insert({ user_id: user, started_at: started, ended_at: ended, title: 'Mock', notes: MARK })
      .select('id')
      .single();
    if (we) throw we;

    let order = 0;
    for (const g of planGroups(k, pools)) {
      const isBlock = !!g.block;
      const blockKey = isBlock ? randomUUID() : null;
      if (isBlock) tally[g.type === 'emom' ? 'emom' : 'superset']++;

      for (const { ex, both } of g.exs) {
        const isTime = ex.metric === 'time';
        if (isTime) tally.hold++;
        if (both) tally.both++;

        const { data: wx, error: wxe } = await db
          .from('workout_exercises')
          .insert({
            workout_id: w.id,
            exercise_id: ex.id,
            order_index: order++, // блок-упражнения идут подряд → группировка на экране работает
            display_name: ex.name_uk,
            block_key: blockKey,
            block_label: isBlock ? g.label : null,
            block_rounds: isBlock ? g.rounds : null,
            block_type: isBlock ? g.type : null,
            block_interval_sec: isBlock ? (g.intervalSec ?? null) : null,
          })
          .select('id')
          .single();
        if (wxe) throw wxe;
        totalWx++;

        // в кластере — по 1 подходу на круг (экран бьёт подходы по раундам = max sets); иначе 3–5
        const setN = isBlock ? g.rounds : isTime ? rnd(3, 4) : rnd(3, 5);
        const baseW = round25((20 + order * 4) * prog * noise);
        const rows = [];
        for (let s = 0; s < setN; s++) {
          rows.push(
            isTime
              ? {
                  workout_exercise_id: wx.id,
                  reps: null,
                  duration_sec: rnd(25, 90), // удержание → наполняет hold_sec
                  weight: null,
                  rpe: rnd(6, 9),
                  meta: both ? { side: 'both' } : null,
                  logged_at: started,
                  completed_at: started,
                }
              : {
                  workout_exercise_id: wx.id,
                  reps: rnd(5, 12),
                  duration_sec: null,
                  weight: baseW + s * 2.5,
                  rpe: rnd(6, 9),
                  meta: both ? { side: 'both' } : null, // «обидві» → ×2 в тоннаже/объёме
                  logged_at: started, // ВАЖНО: без logged_at подход не попадёт в аналитику
                  completed_at: started,
                },
          );
        }
        const { error: se } = await db.from('sets').insert(rows);
        if (se) throw se;
        totalSets += rows.length;
      }
    }
  }
  console.log(`✓ Засидено ${dates.length} тренировок, ${totalWx} упражнений, ${totalSets} подходов (${dates[0]} → ${dates[dates.length - 1]}).`);
  console.log(`  структуры: суперсетов=${tally.superset}, EMOM=${tally.emom}, удержаний=${tally.hold}, ×2(обидві)=${tally.both}`);
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
