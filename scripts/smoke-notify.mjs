// Смоук нотификаций о заявках лидерборда (realtime + remote push).
//   node scripts/smoke-notify.mjs insert   — создать pending-заявку и через 3с апрувнуть
//   node scripts/smoke-notify.mjs cleanup  — удалить тестовые заявки (по note-маркеру)
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
let KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY && existsSync(join(ROOT, '.env'))) {
  const m = readFileSync(join(ROOT, '.env'), 'utf8').match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
  if (m) KEY = m[1].trim();
}
if (!KEY) { console.error('нет SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const EMAIL = 'gonenko1995@gmail.com';
const MARKER = 'smoke-test-notify';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { data: page } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = page.users.find((u) => u.email === EMAIL);
if (!user) { console.error('юзер не найден:', EMAIL); process.exit(1); }

const cmd = process.argv[2];

if (cmd === 'cleanup') {
  const { data, error } = await db.from('leaderboard_entries')
    .delete().eq('user_id', user.id).eq('note', MARKER).select('id');
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`удалено тестовых заявок: ${data.length}`);
  process.exit(0);
}

if (cmd !== 'insert') { console.log('usage: insert|cleanup'); process.exit(1); }

const { data: dyno } = await db.from('dynamometers').select('id, code').eq('is_active', true).limit(1).single();
const { data: ins, error: insErr } = await db.from('leaderboard_entries').insert({
  user_id: user.id,
  board: 'dynamometer',
  dynamometer_id: dyno.id,
  hand: 'right',
  weight_kg: 99.5,
  video_url: 'https://youtube.com/watch?v=smoketest',
  status: 'pending',
  note: MARKER,
}).select('id').single();
if (insErr) { console.error(insErr.message); process.exit(1); }
console.log(`создана pending-заявка ${ins.id.slice(0, 8)} (${dyno.code}, 99.5 кг)`);

await sleep(3000);
const { error: upErr } = await db.from('leaderboard_entries')
  .update({ status: 'approved', verified_at: new Date().toISOString() }).eq('id', ins.id);
if (upErr) { console.error(upErr.message); process.exit(1); }
console.log('апрувнута; зову push-entry-review (remote push, этап 2)...');

const res = await fetch(`${URL}/functions/v1/push-entry-review`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ entryId: ins.id }),
});
console.log('push-entry-review:', res.status, await res.text());
