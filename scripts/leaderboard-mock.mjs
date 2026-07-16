// Мок лидерборда для визуальной проверки объёма (~45 фейк-юзеров, ~100 заявок).
//   node scripts/leaderboard-mock.mjs seed   — засеять
//   node scripts/leaderboard-mock.mjs clean  — удалить всех мок-юзеров (каскадом уйдут заявки)
// Мок-юзеры маркируются email'ом mock.lb.N@example.com — clean находит их по этому паттерну.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const KEY_FILE = join(dirname(fileURLToPath(import.meta.url)), '.service-role-key');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : undefined);
if (!KEY) { console.error('нет SUPABASE_SERVICE_ROLE_KEY (env или scripts/.service-role-key)'); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const MOCK_RE = /^mock\.lb\.\d+@example\.com$/;
const cmd = process.argv[2];

async function listAllUsers() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    out.push(...data.users);
    if (data.users.length < 200) break;
  }
  return out;
}

if (cmd === 'clean') {
  const mocks = (await listAllUsers()).filter((u) => MOCK_RE.test(u.email ?? ''));
  for (const u of mocks) await db.auth.admin.deleteUser(u.id);
  console.log(`удалено мок-юзеров: ${mocks.length} (заявки ушли каскадом)`);
  const { data: left } = await db.from('leaderboard_entries').select('id');
  console.log('заявок осталось в таблице:', left.length);
  process.exit(0);
}

if (cmd !== 'seed') { console.log('usage: node scripts/leaderboard-mock.mjs seed|clean'); process.exit(1); }

const FIRST = ['Влад', 'Денис', 'Олег', 'Андрій', 'Максим', 'Ігор', 'Сергій', 'Юрій', 'Богдан', 'Тарас',
  'Роман', 'Віталій', 'Артем', 'Назар', 'Павло', 'Дмитро', 'Олексій', 'Женя', 'Марко', 'Іван',
  'Kyrylo', 'Petro', 'Stas', 'Vlad G.', 'Danylo', 'Mykola', 'Ostap', 'Orest', 'Timur', 'Lev',
  'Свят', 'Гліб', 'Захар', 'Мирон', 'Клим', 'Арсен', 'Матвій', 'Тимофій', 'Устим', 'Яр',
  'GripMonster', 'IronHands UA', 'CrusherKyiv', 'LvivGrip', 'OdesaSqueeze'];
const AVATAR_KEYS = ['boy', 'girl', 'foxM', 'foxF', 'cat', 'dog', 'panda', 'gorilla', null];
const SET_TYPES = ['tns', 'card', 'deep'];
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rndInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

const { data: dynos } = await db.from('dynamometers').select('id, code').eq('is_active', true);
const { data: grips } = await db.from('grippers').select('id, rgc').eq('is_global', true).not('rgc', 'is', null);

let users = 0;
let entries = 0;
for (let i = 0; i < FIRST.length; i++) {
  const email = `mock.lb.${i}@example.com`;
  const { data: created, error } = await db.auth.admin.createUser({
    email, password: `Mock-${i}-${Date.now()}`, email_confirm: true,
  });
  if (error) { console.error(email, error.message); continue; }
  const uid = created.user.id;
  users++;
  await db.from('profile').update({ display_name: FIRST[i], avatar: rnd(AVATAR_KEYS) }).eq('user_id', uid);

  const n = rndInt(1, 3);
  for (let k = 0; k < n; k++) {
    const isDyno = Math.random() < 0.5;
    // статусы: ~80% approved (наполнить борд), ~15% pending (наполнить админку), ~5% rejected
    const roll = Math.random();
    const status = roll < 0.8 ? 'approved' : roll < 0.95 ? 'pending' : 'rejected';
    const row = {
      user_id: uid,
      board: isDyno ? 'dynamometer' : 'gripper',
      video_url: `https://youtube.com/watch?v=mock${i}x${k}`,
      certified: Math.random() < 0.15,
      status,
      note: Math.random() < 0.2 ? 'мок-заявка' : null,
      verified_at: status === 'pending' ? null : new Date().toISOString(),
    };
    if (isDyno) {
      row.dynamometer_id = rnd(dynos).id;
      row.weight_kg = rndInt(35, 95) + (Math.random() < 0.4 ? 0.5 : 0);
    } else {
      row.gripper_id = rnd(grips).id;
      row.set_type = rnd(SET_TYPES);
    }
    const { error: insErr } = await db.from('leaderboard_entries').insert(row);
    if (insErr) console.error('entry:', insErr.message);
    else entries++;
  }
}
console.log(`создано мок-юзеров: ${users}, заявок: ${entries}`);
console.log('уборка: node scripts/leaderboard-mock.mjs clean');
