// Принимает текст расписания → ИИ раскладывает на блоки (кола/EMOM/суперсеты)
// и упражнения/подходы → пишет в programs. Файлы/клипы не храним, только структуру.
// Матчинг с каталогом: ИИ сам сопоставляет упражнение со списком (по смыслу, любой язык);
// чего нет в каталоге — заводим как кастомное упражнение пользователя.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { runIntent } from '../_shared/ai/gateway.ts';
import { AiError } from '../_shared/ai/types.ts';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM = `You parse strength & CrossFit training programs into structured JSON and map
each exercise to a provided catalog.

Group exercises into BLOCKS — a block is a cluster trained together:
- "rounds": "3 кола" / "3 rounds" → type rounds, rounds=3
- "emom": "EMOM 16" → type emom, interval_sec=60, duration_sec=960
- "e2mom": "E2MOM 16" / every 2 min → type e2mom, interval_sec=120, duration_sec=960
- "amrap": "AMRAP 12" → type amrap, duration_sec=720
- "for_time": "for time"
- "superset": exercises explicitly supersetted together
- "interval": custom time windows (e.g. 00:00-02:00 … / 02:00-04:00 …)
- "single": a normal standalone exercise (one exercise in the block)

Return ONLY a JSON object:
{
  "title": string,            // SHORT concise name, max ~5 words (e.g. "Push day", "Тренування ніг")
  "blocks": [
    {
      "type": "rounds|emom|e2mom|amrap|for_time|superset|interval|single",
      "label": string,            // short label in the user's wording, e.g. "3 кола", "EMOM 16", "E2MOM 16"
      "rounds": number|null,
      "interval_sec": number|null,
      "duration_sec": number|null,
      "rest_sec": number|null,    // rest between rounds if stated
      "exercises": [
        {
          "name": string,                 // CLEAN exercise name (see Naming), do not translate
          "catalog_index": number|null,   // number from CATALOG if it matches by meaning (any language), else null
          "notes": string|null,
          "sets": [
            { "reps": number|null, "duration_sec": number|null, "weight": number|null, "rpe": number|null, "rest_sec": number|null, "notes": string|null }
          ]
        }
      ]
    }
  ]
}
Naming (the "name" field):
- A CLEAN exercise name only — the base movement. Strip weights ("8 кг"), reps, set/round
  counts and other numbers. E.g. "млинів на руку з гирею 8 кг" → "Млини на руку";
  "10 тяг штанги в нахилі (30 кг)" → "Тяга штанги в нахилі". Prefer singular nominative.
- Unilateral (per arm/leg: "права/ліва рука", "5/5 … на руку", alternating each minute) →
  put it in the name: "Жим сидячи однією рукою". Bilateral → no "однією".

Rules:
- Standalone strength moves → their own "single" block. Put ONE exercise per "single" block;
  never pack several different movements into a single "single" block.
- ONE MOVEMENT = ONE EXERCISE WITH MANY SETS. Never emit the same movement as several separate
  exercises. Multiple lines/working sets of the same movement → ONE exercise with that many sets.
  Per-set differences (load, gripper model, band, tempo, side) live ON THE SET — not as a new
  exercise and not dropped. Put the per-set load into the set's weight; put any non-numeric
  per-set descriptor (gripper model, band colour, "per side") into that set's notes.
- GRIPPERS / hand-closers ("еспандер", "Heavy Grips 250", "CoC #2", "expander", "gripper"):
  the load is the gripper model, NOT a weight. → ONE exercise (e.g. "Стиснення еспандера"),
  one SET per gripper line, weight=null, reps=the closes, and the gripper model in the set's
  notes ("Heavy Grips 250"). Three grippers ×5/×2/×4 → one exercise, three sets, three notes.
- "10 тяг штанги в нахилі (30 кг)" → 1 set, reps 10, weight 30.
- "3 жима штанги + 2 швунга (22.5-25 кг)" → two DIFFERENT exercises in the same block.
- "5/5 … на руку", "20/20 сек", "права/ліва рука" mean per-side: keep the per-side number in reps and add "per side" to notes.
- Weights "8 кг", "22.5-25 кг", "5-10 кг": put the number into weight (range → lower bound).
- Time holds / planks / hangs / carries measured in time ("20 сек утримання над головою",
  "планка 60с", "віс 30 сек") → reps null, put the seconds into duration_sec (the number only).
  "20/20 сек на руку" → duration_sec 20 + "per side" in notes.
- Set multipliers EXPAND into that many separate identical sets — NEVER as a note or "xN" text.
  "4x8" → 4 sets of 8. "120*8*3" → 3 sets of weight 120 × 8 reps. "26.25*12*2" → TWO sets of
  26.25 × 12 (not one set with a "x2" note). Within a superset this is fine even if it makes one
  exercise have more sets than the other — just emit all the real sets. Reps range (8-10) → lower bound.
- catalog_index: set ONLY when the catalog entry is clearly the SAME exercise (same movement
  AND equipment). For variations, accessory work, band/rubber drills, scapular/holds or anything
  not obviously present — use null. NEVER force a loose match; a wrong match is worse than null.
  Unmatched items are saved verbatim as the user's own exercise.
- rpe 1..10 or null.
- Output valid JSON only, no markdown, no commentary.`;

type ParsedSet = {
  reps: number | null;
  duration_sec: number | null;
  weight: number | null;
  rpe: number | null;
  rest_sec: number | null;
  notes: string | null;
};
type ParsedExercise = {
  name: string;
  catalog_index: number | null;
  notes: string | null;
  sets: ParsedSet[];
};
type ParsedBlock = {
  type: string | null;
  label: string | null;
  rounds: number | null;
  interval_sec: number | null;
  duration_sec: number | null;
  rest_sec: number | null;
  exercises: ParsedExercise[];
};
type Parsed = { title: string; blocks: ParsedBlock[] };

type CatalogItem = { id: string; name_en: string; name_uk: string };

function safeParse(text: string): Parsed {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t) as Parsed;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

// Страховка: если модель всё же оставила множитель подходов как заметку "x2"/"×3" — разворачиваем
// в N одинаковых подходов (а не одну строку с припиской). Закрывает кейс "26.25*12*2".
function expandSetMultipliers(sets: ParsedSet[]): ParsedSet[] {
  const out: ParsedSet[] = [];
  for (const s of sets) {
    const m = typeof s.notes === 'string' ? s.notes.trim().match(/^[x×х*]\s*(\d{1,2})$/i) : null;
    const n = m ? Math.min(20, Math.max(1, parseInt(m[1], 10))) : 1;
    const base = m ? { ...s, notes: null } : s;
    for (let i = 0; i < n; i++) out.push(base);
  }
  return out;
}

// Проверка, что выбранное моделью совпадение из каталога реально похоже на исходное имя:
// модель уже матчит по СМЫСЛУ, это лишь предохранитель от явного бреда
// (млин з гирею → турецький підйом). Поэтому терпим к опечаткам/коротким/слитным
// словам (жемлёжа → Жим лёжа), иначе верный матч отклоняется и плодятся дубль-кастомы.
function normName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function tokens(s: string): string[] {
  return normName(s).split(' ').filter((w) => w.length >= 3);
}
// расстояние Левенштейна (две строки состояния, O(n) памяти)
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(prev[j], prev[j - 1], diag);
      diag = tmp;
    }
  }
  return prev[n];
}
// два слова «похожи»: равны, длинное содержит короткое (≥4 симв.), либо ~1 опечатка на 4 символа
function tokenMatch(x: string, y: string): boolean {
  if (x === y) return true;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  if (short.length >= 4 && long.includes(short)) return true;
  const tol = Math.max(1, Math.floor(Math.max(x.length, y.length) / 4));
  return editDistance(x, y) <= tol;
}
function namesResemble(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  for (const x of ta) for (const y of tb) if (tokenMatch(x, y)) return true;
  // слитное написание против раздельного: «жемлёжа» ↔ «жим лёжа»
  const na = normName(a).replace(/ /g, '');
  const nb = normName(b).replace(/ /g, '');
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  // ни одно из имён не дало значимых токенов (≥3 симв.) — сравниваем целиком
  if (ta.length === 0 || tb.length === 0) {
    if (!na || !nb) return false;
    return editDistance(na, nb) <= Math.max(1, Math.floor(Math.max(na.length, nb.length) / 4));
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_authorization' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const { text } = await req.json().catch(() => ({ text: '' }));
    if (!text || typeof text !== 'string' || text.trim().length < 3) {
      return json({ error: 'empty_input' }, 400);
    }

    const admin = createClient(url, serviceKey);

    // единица пользователя — числа в тексте трактуем в ней, храним канонически в кг
    const { data: prof } = await admin
      .from('profile')
      .select('units')
      .eq('user_id', userId)
      .maybeSingle();
    const userUnit = prof?.units === 'lb' ? 'lb' : 'kg';
    const LB_PER_KG = 2.2046226218;
    const weightToKg = (w: number | null): number | null =>
      w == null ? null : userUnit === 'lb' ? w / LB_PER_KG : w;

    // каталог для матчинга (общий + личный пользователя)
    const { data: catRows } = await admin
      .from('exercises')
      .select('id, name_en, name_uk')
      .or(`owner_id.eq.${userId},is_global.eq.true`)
      .order('name_en');
    const catalog: CatalogItem[] = (catRows ?? []) as CatalogItem[];
    const catalogBlock = catalog
      .map((c, i) => `${i + 1}. ${c.name_en} / ${c.name_uk}`)
      .join('\n');

    const result = await runIntent(admin, userId, 'program_import', {
      system: `${SYSTEM}\n\nCATALOG (catalog_index → this number):\n${catalogBlock}`,
      messages: [{ role: 'user', content: text.slice(0, 12000) }],
      json: true,
      maxTokens: 4096,
    });

    let parsed: Parsed;
    try {
      parsed = safeParse(result.text);
    } catch {
      return json({ error: 'parse_failed', raw: result.text.slice(0, 800) }, 422);
    }

    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    if (blocks.length === 0) return json({ error: 'no_exercises' }, 422);

    const { data: program, error: pErr } = await admin
      .from('programs')
      .insert({ user_id: userId, title: parsed.title?.slice(0, 200) || 'Imported program', source: 'ai_import' })
      .select('id')
      .single();
    if (pErr) return json({ error: pErr.message }, 500);

    let created = 0;       // новых кастомных упражнений
    let exerciseCount = 0; // всего упражнений

    const resolveExerciseId = async (ex: ParsedExercise): Promise<string | null> => {
      const name = (ex.name ?? '').trim().slice(0, 200);
      if (!name) return null;

      const idx = num(ex.catalog_index);
      if (idx != null && idx >= 1 && idx <= catalog.length) {
        const c = catalog[idx - 1];
        // доверяем индексу, только если имена реально похожи; иначе — не матчим
        if (namesResemble(name, c.name_en) || namesResemble(name, c.name_uk)) return c.id;
      }

      const safe = name.replace(/[(),{}*%]/g, ' ').trim();
      if (safe) {
        const { data: m } = await admin
          .from('exercises')
          .select('id')
          .or(`owner_id.eq.${userId},is_global.eq.true`)
          .or(`name_en.ilike.${safe},name_uk.ilike.${safe}`)
          .limit(1)
          .maybeSingle();
        if (m?.id) return m.id;
      }

      const { data: newEx, error: cErr } = await admin
        .from('exercises')
        .insert({ owner_id: userId, name_en: name, name_uk: name, is_global: false })
        .select('id')
        .single();
      if (cErr) throw new Error(cErr.message);
      created++;
      return newEx.id;
    };

    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      const exs = Array.isArray(b.exercises) ? b.exercises : [];
      if (exs.length === 0) continue;

      const { data: block, error: bErr } = await admin
        .from('program_blocks')
        .insert({
          program_id: program.id,
          order_index: bi,
          type: str(b.type) ?? 'single',
          label: str(b.label),
          rounds: num(b.rounds),
          interval_sec: num(b.interval_sec),
          duration_sec: num(b.duration_sec),
          rest_sec: num(b.rest_sec),
        })
        .select('id')
        .single();
      if (bErr) return json({ error: bErr.message }, 500);

      // fallbackNote: при слиянии повтора-упражнения переносим его описание (гриппер/снаряд)
      // на подход, чтобы инфо не терялась, даже если модель положила её в notes упражнения.
      const setFields = (s: ParsedSet, fallbackNote: string | null = null) => ({
        target_reps: num(s.reps),
        target_duration_sec: num(s.duration_sec),
        target_weight: weightToKg(num(s.weight)),
        target_rpe: num(s.rpe),
        rest_sec: num(s.rest_sec),
        notes: s.notes ?? fallbackNote ?? null,
      });

      // один и тот же снаряд подряд (эспандер на разных грипперах, повтор строки) — это ДОП.
      // ПОДХОДЫ, а не новые упражнения. Дописываем их в предыдущее упражнение блока.
      let lastPeId: string | null = null;
      let lastExId: string | null = null;
      let lastSetCount = 0;

      for (let ei = 0; ei < exs.length; ei++) {
        const ex = exs[ei];
        const name = (ex.name ?? '').trim().slice(0, 200);
        if (!name) continue;

        const exerciseId = await resolveExerciseId(ex);
        const sets = expandSetMultipliers(Array.isArray(ex.sets) ? ex.sets : []);

        if (exerciseId && exerciseId === lastExId && lastPeId) {
          if (sets.length > 0) {
            const rows = sets.map((s, j) => ({
              program_exercise_id: lastPeId,
              order_index: lastSetCount + j,
              ...setFields(s, str(ex.notes)),
            }));
            const { error: sErr } = await admin.from('program_sets').insert(rows);
            if (sErr) return json({ error: sErr.message }, 500);
            lastSetCount += sets.length;
          }
          continue;
        }

        exerciseCount++;

        const { data: pe, error: peErr } = await admin
          .from('program_exercises')
          .insert({
            program_id: program.id,
            block_id: block.id,
            exercise_id: exerciseId,
            name,
            order_index: ei,
            notes: ex.notes ?? null,
          })
          .select('id')
          .single();
        if (peErr) return json({ error: peErr.message }, 500);

        if (sets.length > 0) {
          const rows = sets.map((s, j) => ({
            program_exercise_id: pe.id,
            order_index: j,
            ...setFields(s),
          }));
          const { error: sErr } = await admin.from('program_sets').insert(rows);
          if (sErr) return json({ error: sErr.message }, 500);
        }

        lastPeId = pe.id;
        lastExId = exerciseId;
        lastSetCount = sets.length;
      }
    }

    return json({
      program_id: program.id,
      block_count: blocks.length,
      exercise_count: exerciseCount,
      created_exercises: created,
      cost: result.cost,
      provider: result.provider,
      model: result.model,
    });
  } catch (e) {
    if (e instanceof AiError) {
      const status = e.code === 'budget_exceeded' ? 429 : 502;
      return json({ error: e.code, detail: e.message }, status);
    }
    return json({ error: String(e) }, 500);
  }
});
