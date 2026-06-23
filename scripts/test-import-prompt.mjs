// Локальный прогон промпта workout-import (импорт прошлой тренировки) без деплоя.
// Берёт SYSTEM прямо из supabase/functions/workout-import/index.ts (без дубля → не дрейфует),
// повторяет боевой вызов OpenAI (gpt-5.4-mini, json_object) и печатает разбор каждой
// тренировки + компактную сводку (дата / блоки-типы / стороны / множители) для глаз.
//
// Запуск:
//   OPENAI_API_KEY=sk-... node scripts/test-import-prompt.mjs
//   (PowerShell)  $env:OPENAI_API_KEY="sk-..."; node scripts/test-import-prompt.mjs
//
// Фикстуры: каждая тренировка — отдельный .txt в scripts/import-fixtures/ (как из блокнота).
// Один файл = один вызов. Имя файла попадает в заголовок прогона.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX_TS = join(ROOT, 'supabase', 'functions', 'workout-import', 'index.ts');
const FIXTURES_DIR = join(__dirname, 'import-fixtures');

const MODEL = process.env.IMPORT_MODEL || 'gpt-5.4-mini'; // = ai_model_routes['program_import']
// Ключ: из окружения, иначе из gitignored scripts/.openai-key (чтобы не светить в команде).
const KEY_FILE = join(__dirname, '.openai-key');
const KEY =
  process.env.OPENAI_API_KEY ||
  (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : undefined);

// Небольшой представительный каталог, чтобы catalog_index был осмысленным.
// (Боевая функция тянет каталог юзера из БД; для проверки сторон/суперсетов хватает этого.)
const CATALOG = [
  'Bench press / Жим лежачи',
  'Wrist curl / Згинання кисті',
  'Pronation / Пронація',
  'Wrist pull / Натяжка через кисть',
  'One-arm pull-up / Підтягування на одній руці',
  'Gripper close / Стиснення еспандера',
  'Hammer curl / Молоткові згинання',
  'Side pressure / Бокове тиснення',
];

function extractSystem() {
  const src = readFileSync(INDEX_TS, 'utf8');
  const m = src.match(/const SYSTEM = `([\s\S]*?)`;/);
  if (!m) throw new Error('Не нашёл `const SYSTEM = `...`;` в ' + INDEX_TS);
  return m[1];
}

function loadFixtures() {
  if (!existsSync(FIXTURES_DIR)) {
    throw new Error(
      `Нет папки ${FIXTURES_DIR}. Положи туда .txt с текстами блокнотных тренировок (по одному файлу).`,
    );
  }
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  if (!files.length) throw new Error(`В ${FIXTURES_DIR} нет .txt-фикстур.`);
  return files.map((f) => ({ name: f, text: readFileSync(join(FIXTURES_DIR, f), 'utf8').trim() }));
}

async function callModel(system, text) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text.slice(0, 12000) },
      ],
      max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function safeParse(t) {
  let s = t.trim();
  if (s.startsWith('```')) s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(s);
}

// Компактная сводка: то, на что бьёт пятничная правка (стороны, суперсеты, множители-как-подходы).
function summarize(p) {
  const lines = [];
  lines.push(`  date: ${p.date ?? '∅'}   title: ${p.title ?? '∅'}`);
  if (p.session_note) lines.push(`  session_note: ${p.session_note}`);
  for (const b of p.blocks ?? []) {
    const exN = (b.exercises ?? []).length;
    const tag = b.type === 'single' ? 'single' : `«${b.type}»${b.label ? ` (${b.label})` : ''}`;
    lines.push(`  ▸ block ${tag} — ${exN} упр${b.type !== 'single' && exN > 1 ? ' [кластер]' : ''}`);
    for (const ex of b.exercises ?? []) {
      const sets = ex.sets ?? [];
      const sides = sets.map((s) => s.side ?? '·').join(',');
      const reps = sets
        .map((s) => {
          const base = `${s.weight ?? '–'}×${s.reps ?? (s.duration_sec ? s.duration_sec + 'с' : '?')}`;
          const grip = s.gripper ? ` {${s.gripper}${s.set_type ? '/' + s.set_type : ''}}` : '';
          const ch = s.cheat ? ' ✶cheat' : '';
          return base + grip + ch;
        })
        .join(' | ');
      lines.push(`      • ${ex.name}  [${sets.length} підх; side: ${sides}]  ${reps}`);
      for (const s of sets) if (s.notes) lines.push(`          note: ${s.notes}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  if (!KEY) {
    console.error('✗ Нет ключа. Положи его в scripts/.openai-key или $env:OPENAI_API_KEY="sk-..."');
    process.exit(1);
  }
  const system =
    extractSystem() + '\n\nCATALOG (catalog_index → this number):\n' +
    CATALOG.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const fixtures = loadFixtures();
  console.log(`Модель: ${MODEL}   фикстур: ${fixtures.length}\n${'='.repeat(72)}`);

  for (const fx of fixtures) {
    console.log(`\n### ${fx.name}`);
    try {
      const raw = await callModel(system, fx.text);
      let parsed;
      try {
        parsed = safeParse(raw);
      } catch (e) {
        console.log(`  ✗ parse_failed: ${e.message}\n  raw: ${raw.slice(0, 400)}`);
        continue;
      }
      console.log(summarize(parsed));
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
    }
  }
  console.log(`\n${'='.repeat(72)}\nГотово. Сверь стороны (Л:/П: vs суперсет-лейблы Н:/П:), даты, множители xN → отдельные подходы.`);
}

main();
