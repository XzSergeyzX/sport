// Сидер превью-аккаунта (preview-claude@sporty.local) для смоуков на веб-превью:
// OURA-снимки (75 дн; готовность чередуется высокая/низкая по чётности дня — корзины
// «легкість ↔ готовність» наполняются на любом окне) + 3 отметки цикла + флаги профиля.
// Тренировки сеет штатный seed-mock-workouts.mjs --user <uuid> (uuid печатается в конце).
// Аккаунт throwaway (grip). Чистка: health_snapshots/cycle_periods удалить по user_id,
// тренировки — seed-mock-workouts.mjs --clean --user <uuid>.
//
// Запуск: $env:SUPABASE_SERVICE_ROLE_KEY=...; node scripts/seed-preview-health.mjs

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error('✗ Нет SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });
const EMAIL = 'preview-claude@sporty.local';
const DAYS = 75;

const ymd = (d) => d.toISOString().slice(0, 10);
const rnd = (min, max) => Math.round(min + Math.random() * (max - min));

(async () => {
  // uuid превью-юзера — по email через admin API
  const { data: page, error: ue } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (ue) throw ue;
  const user = page.users.find((u) => u.email === EMAIL);
  if (!user) throw new Error(`юзер ${EMAIL} не найден`);
  console.log(`user_id = ${user.id}`);

  // снимки: чередуем высокую/низкую готовность по чётности дня — обе корзины
  // «легкість ↔ готовність» гарантированно наполняются на любом окне
  const rows = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const high = i % 2 === 0;
    rows.push({
      user_id: user.id,
      date: ymd(d),
      readiness: high ? rnd(82, 93) : rnd(58, 76),
      sleep_score: high ? rnd(78, 92) : rnd(55, 75),
      hrv: rnd(35, 95),
      rhr: rnd(48, 62),
      sleep_total_min: rnd(360, 510),
      sleep_efficiency: rnd(82, 96),
      respiratory_rate: 13 + Math.random() * 3,
      temp: Math.round((Math.random() - 0.4) * 10) / 10,
      spo2_avg: 95 + Math.random() * 3,
      stress_high_min: rnd(5, 120),
      activity_score: rnd(60, 95),
      steps: rnd(3000, 14000),
    });
  }
  const { error: se } = await db
    .from('health_snapshots')
    .upsert(rows, { onConflict: 'user_id,date' });
  if (se) throw se;
  console.log(`✓ снимков: ${rows.length} (${rows[0].date} → ${rows[rows.length - 1].date})`);

  // 3 старта цикла ~28-29 дн: последний недавно, чтобы карточка показывала текущий день/фазу
  const starts = [];
  for (const back of [65, 37, 8]) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    starts.push({ user_id: user.id, start_date: ymd(d) });
  }
  const { error: ce } = await db
    .from('cycle_periods')
    .upsert(starts, { onConflict: 'user_id,start_date' });
  if (ce) throw ce;
  console.log(`✓ стартов цикла: ${starts.map((s) => s.start_date).join(', ')}`);

  const { error: pe, data: prof } = await db
    .from('profile')
    .update({ oura_connected: true, track_cycle: true, bodyweight: 70 })
    .eq('user_id', user.id)
    .select('user_id');
  if (pe) throw pe;
  if (!prof?.length) throw new Error('profile-строка не найдена — онбординг превью-аккаунта не пройден?');
  console.log('✓ profile: oura_connected + track_cycle + bodyweight');
  console.log(`Дальше: node scripts/seed-mock-workouts.mjs --user ${user.id} --count 24`);
})().catch((e) => {
  console.error('✗', e.message ?? e);
  process.exit(1);
});
