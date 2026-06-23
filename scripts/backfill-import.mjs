// Бэкфилл прошлых тренировок: парсит scripts/import-fixtures/*.txt тем же SYSTEM, что в
// supabase/functions/workout-import/index.ts (без дубля промпта), и вставляет ЗАВЕРШЁННЫЕ тренировки
// через service-role для юзера gonenko1995. Портирует логику функции (каталог/грипперы/резолв/вставка).
// ВНИМАНИЕ: это одноразовый бэкфилл, идёт мимо бюджет-гейта (runIntent) — 9 мелких вызовов, копейки.
//
// Dry-run (по умолчанию): печатает разбор + матч грипперов (✓/✗), НИЧЕГО не вставляет.
// Применить: node scripts/backfill-import.mjs --apply
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX_TS = join(ROOT, 'supabase', 'functions', 'workout-import', 'index.ts');
const FIXTURES_DIR = join(__dirname, 'import-fixtures');
const MODEL = process.env.IMPORT_MODEL || 'gpt-5.4-mini';

const readKey = (f) => (existsSync(join(__dirname, f)) ? readFileSync(join(__dirname, f), 'utf8').trim() : undefined);
const OPENAI_KEY = process.env.OPENAI_API_KEY || readKey('.openai-key');
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || readKey('.service-role-key');
if (!OPENAI_KEY || !SR_KEY) {
  console.error('✗ Нужны scripts/.openai-key и scripts/.service-role-key');
  process.exit(1);
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const db = createClient(URL, SR_KEY, { auth: { persistSession: false } });

// SYSTEM прямо из функции (без дубля → не дрейфует)
function extractSystem() {
  const m = readFileSync(INDEX_TS, 'utf8').match(/const SYSTEM = `([\s\S]*?)`;/);
  if (!m) throw new Error('Не нашёл SYSTEM в index.ts');
  return m[1];
}
// хелперы (копия из функции)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const safeParse = (t) => {
  t = t.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
};
const tokens = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 4);
const namesResemble = (a, b) => {
  const tb = tokens(b);
  for (const x of tokens(a)) for (const y of tb) if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  return false;
};
const isCluster = (type) => !!type && type !== 'single';
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function callModel(system, text) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: text.slice(0, 12000) }],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices[0].message.content;
}

// юзер + каталоги (как в функции)
const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const me = users.users.find((u) => (u.email ?? '').includes('gonenko1995'));
const userId = me.id;
const { data: prof } = await db.from('profile').select('units').eq('user_id', userId).maybeSingle();
const userUnit = prof?.units === 'lb' ? 'lb' : 'kg';
const LB = 2.2046226218;
const toKg = (w) => (w == null ? null : userUnit === 'lb' ? w / LB : w);

const { data: catRows } = await db.from('exercises').select('id,name_en,name_uk,log_kind').or(`owner_id.eq.${userId},is_global.eq.true`).order('name_en');
const catalog = catRows ?? [];
const gripperEx =
  catalog.find((c) => c.log_kind === 'gripper' && /close|стиснення/i.test(`${c.name_en} ${c.name_uk}`)) ??
  catalog.find((c) => c.log_kind === 'gripper') ?? null;
const { data: gripRows } = await db.from('grippers').select('id,brand,name,owner_id').or(`owner_id.eq.${userId},is_global.eq.true`);
const grippers = (gripRows ?? []).sort((a, b) => (a.owner_id ? 0 : 1) - (b.owner_id ? 0 : 1));
const SET_TYPES = ['tns', 'card', 'block_38', 'block_20', 'deep'];
function resolveGripperId(model) {
  const m = norm(model);
  for (const g of grippers) {
    const b = norm(g.brand ?? ''); const n = norm(g.name);
    if (n && m.includes(n) && (!b || m.includes(b))) return g.id;
  }
  const byKey = grippers.filter((g) => {
    const b = norm(g.brand ?? ''); const key = norm(g.name).split(' ')[0];
    return key && b && m.includes(b) && m.includes(key);
  });
  return byKey.length === 1 ? byKey[0].id : null;
}
const gripName = (id) => { const g = grippers.find((x) => x.id === id); return g ? `${g.brand ?? ''} ${g.name}` : '?'; };
const catalogBlock = catalog.map((c, i) => `${i + 1}. ${c.name_en} / ${c.name_uk}`).join('\n');
const SYSTEM = extractSystem();

async function resolveId(ex) {
  const name = (ex.name ?? '').trim().slice(0, 200); if (!name) return null;
  const idx = num(ex.catalog_index);
  if (idx != null && idx >= 1 && idx <= catalog.length) {
    const c = catalog[idx - 1];
    if (namesResemble(name, c.name_en) || namesResemble(name, c.name_uk)) return c.id;
  }
  const safe = name.replace(/[(),{}*%]/g, ' ').trim();
  if (safe) {
    const { data: m } = await db.from('exercises').select('id').or(`owner_id.eq.${userId},is_global.eq.true`).or(`name_en.ilike.${safe},name_uk.ilike.${safe}`).limit(1).maybeSingle();
    if (m?.id) return m.id;
  }
  if (!APPLY) return '(new)';
  const { data: created, error } = await db.from('exercises').insert({ owner_id: userId, name_en: name, name_uk: name, is_global: false }).select('id').single();
  if (error) throw new Error(error.message);
  return created.id;
}

const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.txt')).sort();
console.log(`Юзер: ${me.email}   фикстур: ${files.length}   режим: ${APPLY ? 'APPLY' : 'dry-run'}`);
for (const f of files) {
  const text = readFileSync(join(FIXTURES_DIR, f), 'utf8').trim();
  let parsed;
  try { parsed = safeParse(await callModel(`${SYSTEM}\n\nCATALOG (catalog_index → this number):\n${catalogBlock}`, text)); }
  catch (e) { console.log(`\n### ${f}  ✗ ${e.message}`); continue; }
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date ?? '') ? parsed.date : new Date().toISOString().slice(0, 10);
  const totalSets = blocks.reduce((n, b) => n + (b.exercises ?? []).reduce((m, e) => m + (e.sets?.length ?? 0), 0), 0);
  const estMin = Math.min(120, Math.max(8, Math.round(5 + totalSets * 2.5)));
  const startedAt = new Date(`${ymd}T12:00:00.000Z`);
  const endedAt = new Date(+startedAt + estMin * 60000);
  console.log(`\n### ${f} → ${ymd}  "${str(parsed.title) ?? '—'}"  (${totalSets} подх)`);

  let workoutId = null;
  if (APPLY) {
    const { data: w, error } = await db.from('workouts').insert({ user_id: userId, started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), title: str(parsed.title)?.slice(0, 120) ?? null, notes: str(parsed.session_note)?.slice(0, 1000) ?? null }).select('id').single();
    if (error) { console.log('  ✗ workout: ' + error.message); continue; }
    workoutId = w.id;
  }
  let order = 0;
  for (const b of blocks) {
    const exs = (b.exercises ?? []).filter((e) => str(e.name) && (e.sets?.length ?? 0) > 0);
    if (!exs.length) continue;
    const cluster = isCluster(b.type ?? null);
    const blockKey = cluster ? (APPLY ? crypto.randomUUID() : '<bk>') : null;
    for (const ex of exs) {
      const isGripperEx = !!gripperEx && (ex.sets ?? []).some((s) => str(s.gripper));
      const exerciseId = isGripperEx ? gripperEx.id : await resolveId(ex);
      const dispName = (isGripperEx ? gripperEx.name_uk : ex.name).trim().slice(0, 200);
      const desc = (ex.sets ?? []).map((s) => {
        const gid = str(s.gripper) ? resolveGripperId(s.gripper) : null;
        const g = s.gripper ? ` {${gid ? '✓' + gripName(gid) : '✗' + s.gripper}/${s.set_type ?? ''}}` : '';
        const w = s.gripper ? '–' : (s.weight ?? '–');
        const r = s.reps ?? (s.duration_sec ? s.duration_sec + 'с' : '?');
        return `${w}×${r}${s.side ? ' ' + s.side : ''}${s.cheat ? ' cheat' : ''}${g}`;
      }).join(' | ');
      console.log(`  • ${dispName}${cluster ? ` [${b.type}]` : ''}  ${desc}`);
      if (!APPLY) continue;
      const { data: we, error: weErr } = await db.from('workout_exercises').insert({ workout_id: workoutId, exercise_id: exerciseId, order_index: order++, display_name: dispName, done_at: endedAt.toISOString(), block_key: blockKey, block_label: cluster ? (str(b.label) ?? null) : null, block_type: cluster ? (b.type ?? null) : null }).select('id').single();
      if (weErr) { console.log('  ✗ we: ' + weErr.message); continue; }
      const rows = (ex.sets ?? []).map((s) => {
        const side = ['left', 'right', 'both'].includes(s.side) ? s.side : null;
        const gid = str(s.gripper) ? resolveGripperId(s.gripper) : null;
        const stype = SET_TYPES.includes(s.set_type ?? '') ? s.set_type : null;
        const meta = {};
        if (side) meta.side = side;
        if (s.cheat === true) meta.cheat = true;
        if (gid) meta.gripper_id = gid;
        if (stype) meta.set_type = stype;
        return { workout_exercise_id: we.id, weight: gid ? null : toKg(num(s.weight)), reps: num(s.reps), duration_sec: num(s.duration_sec), rpe: num(s.rpe), logged_at: endedAt.toISOString(), meta: Object.keys(meta).length ? meta : null };
      });
      const { error: sErr } = await db.from('sets').insert(rows);
      if (sErr) console.log('  ✗ sets: ' + sErr.message);
    }
  }
}
console.log(`\n${APPLY ? '=== ЗАЛИТО ===' : '=== DRY-RUN (запусти с --apply для вставки) ==='}`);
