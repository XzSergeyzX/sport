// Сливает подряд идущие program_exercises с одинаковым exercise_id (в пределах одного блока)
// в ОДНО упражнение с N подходами. Это лечит артефакт импорта, когда один и тот же снаряд
// (эспандер) разбит на 3 «упражнения» по 1 подходу вместо 1 упражнения с 3 подходами.
//
// Сухой прогон (по умолчанию): печатает план, ничего не меняет.
// Применить:  node scripts/merge-dup-exercises.mjs --apply
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const me = users.users.find((u) => (u.email ?? '').includes('gonenko1995'));

const { data: progs } = await db.from('programs').select('id,title').eq('user_id', me.id);

let mergedTotal = 0;
for (const p of progs ?? []) {
  const { data: pes } = await db
    .from('program_exercises')
    .select('id, block_id, exercise_id, name, order_index, program_sets(id, order_index)')
    .eq('program_id', p.id)
    .order('order_index', { ascending: true });

  // группируем по block_id (сохраняя порядок), внутри — сливаем подряд идущие с тем же exercise_id
  const byBlock = new Map();
  for (const pe of pes ?? []) {
    const k = pe.block_id ?? '__null__';
    if (!byBlock.has(k)) byBlock.set(k, []);
    byBlock.get(k).push(pe);
  }

  for (const [, list] of byBlock) {
    list.sort((a, b) => a.order_index - b.order_index);
    let anchor = null;
    for (const pe of list) {
      if (anchor && pe.exercise_id && pe.exercise_id === anchor.exercise_id) {
        // сливаем pe → anchor
        const base = anchor._setCount;
        const sets = (pe.program_sets ?? []).sort((a, b) => a.order_index - b.order_index);
        console.log(`  [${p.title}] merge "${pe.name}" (${sets.length} set) → "${anchor.name}" (start order ${base})`);
        mergedTotal++;
        if (APPLY) {
          for (let i = 0; i < sets.length; i++)
            await db.from('program_sets').update({ program_exercise_id: anchor.id, order_index: base + i }).eq('id', sets[i].id);
          await db.from('program_exercises').delete().eq('id', pe.id);
        }
        anchor._setCount += sets.length;
      } else {
        anchor = pe;
        anchor._setCount = (pe.program_sets ?? []).length;
      }
    }
  }
}
console.log(`\n${APPLY ? 'СЛИТО' : 'БУДЕТ СЛИТО'}: ${mergedTotal} дубль-упражнений${APPLY ? '' : '  (запусти с --apply для применения)'}`);
