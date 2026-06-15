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
- Standalone strength moves → their own "single" block.
- "10 тяг штанги в нахилі (30 кг)" → 1 set, reps 10, weight 30.
- "3 жима штанги + 2 швунга (22.5-25 кг)" → two exercises in the same block.
- "5/5 … на руку", "20/20 сек", "права/ліва рука" mean per-side: keep the per-side number in reps and add "per side" to notes.
- Weights "8 кг", "22.5-25 кг", "5-10 кг": put the number into weight (range → lower bound).
- Time holds / planks / hangs / carries measured in time ("20 сек утримання над головою",
  "планка 60с", "віс 30 сек") → reps null, put the seconds into duration_sec (the number only).
  "20/20 сек на руку" → duration_sec 20 + "per side" in notes.
- "4x8" → 4 sets of 8. "120*8*3" → 3 sets of 8 at weight 120. Reps range (8-10) → lower bound.
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

// Грубая проверка, что найденное в каталоге совпадение реально похоже на исходное имя —
// чтобы модель не «лепила» левый индекс (млин з гирею → турецький підйом).
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 4);
}
function namesResemble(a: string, b: string): boolean {
  const tb = tokens(b);
  for (const x of tokens(a))
    for (const y of tb) if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
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

      for (let ei = 0; ei < exs.length; ei++) {
        const ex = exs[ei];
        const name = (ex.name ?? '').trim().slice(0, 200);
        if (!name) continue;

        const exerciseId = await resolveExerciseId(ex);
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

        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        if (sets.length > 0) {
          const rows = sets.map((s, j) => ({
            program_exercise_id: pe.id,
            order_index: j,
            target_reps: num(s.reps),
            target_duration_sec: num(s.duration_sec),
            target_weight: weightToKg(num(s.weight)),
            target_rpe: num(s.rpe),
            rest_sec: num(s.rest_sec),
            notes: s.notes ?? null,
          }));
          const { error: sErr } = await admin.from('program_sets').insert(rows);
          if (sErr) return json({ error: sErr.message }, 500);
        }
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
