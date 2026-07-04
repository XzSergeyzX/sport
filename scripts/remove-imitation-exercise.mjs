// Удаляет generic catch-all упражнение «Імітація руху» из каталога.
// Это свалка нераспознанного из СТАРОГО (до-переделочного) импорта; после фикса
// матчинга (namesResemble, день-39) оно больше не нужно и мешает каталогу.
//
// БЕЗОПАСНО: dry-run по умолчанию. Удаляет ТОЛЬКО если на упражнение не осталось
// НИ ОДНОЙ FK-ссылки (workout_exercises / program_exercises / personal_records).
// Если ссылки есть (напр. ещё не снесены программы Маши) — печатает счётчики и
// НИЧЕГО не трогает. Порядок: сначала удалить ссылающиеся программы, потом этот скрипт.
//
// Запуск (dry-run):  node scripts/remove-imitation-exercise.mjs
// Применить:         node scripts/remove-imitation-exercise.mjs --apply
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const readFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);
// читаем переменную из корневого .env (node сам .env не подхватывает)
const fromEnvFile = (name) => {
  const txt = readFile(join(ROOT, '.env'));
  if (!txt) return undefined;
  const m = txt.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
};
const SR_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  readFile(join(__dirname, '.service-role-key'))?.trim() ||
  fromEnvFile('SUPABASE_SERVICE_ROLE_KEY');
if (!SR_KEY) {
  console.error('✗ Нужен SUPABASE_SERVICE_ROLE_KEY: env-переменная, scripts/.service-role-key или строка в .env');
  process.exit(1);
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const db = createClient(URL, SR_KEY, { auth: { persistSession: false } });

const NAMES = ['Імітація руху', 'Imitation of movement']; // uk / возможный en

async function countRefs(table, exerciseId) {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('exercise_id', exerciseId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  // ищем generic-запись по имени среди глобальных (owner_id IS NULL / is_global)
  const { data: rows, error } = await db
    .from('exercises')
    .select('id, name_en, name_uk, is_global, owner_id')
    .or(NAMES.map((n) => `name_uk.eq.${n}`).concat(NAMES.map((n) => `name_en.eq.${n}`)).join(','));
  if (error) throw new Error(error.message);

  const targets = (rows ?? []).filter((r) => r.is_global || r.owner_id == null);
  if (targets.length === 0) {
    console.log('Ничего не найдено: глобальной «Імітація руху» в каталоге нет (возможно, уже удалена).');
    return;
  }

  for (const ex of targets) {
    console.log(`\nНайдено: ${ex.id}`);
    console.log(`  name_en=${JSON.stringify(ex.name_en)}  name_uk=${JSON.stringify(ex.name_uk)}  is_global=${ex.is_global}  owner_id=${ex.owner_id}`);

    // personal_records выкинута миграцией 20260704110000 — считаем только живые FK
    const we = await countRefs('workout_exercises', ex.id);
    const pe = await countRefs('program_exercises', ex.id);
    const total = we + pe;
    console.log(`  ссылки: workout_exercises=${we}  program_exercises=${pe}  (всего ${total})`);

    if (total > 0) {
      console.log('  ⏭️  ПРОПУСК: есть FK-ссылки. Сначала удалить ссылающиеся программы/тренировки, потом перезапустить.');
      continue;
    }

    if (!APPLY) {
      console.log('  [dry-run] удалил бы (ссылок нет). Запусти с --apply, чтобы применить.');
      continue;
    }

    const { error: delErr } = await db.from('exercises').delete().eq('id', ex.id);
    if (delErr) {
      console.log(`  ✗ удаление не удалось: ${delErr.message}`);
      continue;
    }
    console.log('  ✅ удалено.');
  }

  if (!APPLY) console.log('\n(dry-run — ничего не изменено)');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
