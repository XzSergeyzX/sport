// Принимает текст расписания → ИИ раскладывает на упражнения/подходы → пишет в programs.
// Файлы/клипы не храним; парсим и сохраняем только структуру.
// Матчинг с каталогом: ИИ сам сопоставляет упражнение со списком каталога (по смыслу,
// на любом языке); чего нет в каталоге — заводим как кастомное упражнение пользователя.
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

const SYSTEM = `You parse strength-training programs into structured JSON and map each
exercise to a provided catalog.
Return ONLY a JSON object with this exact shape:
{
  "title": string,                       // short program title
  "exercises": [
    {
      "name": string,                    // exercise name as written by the user
      "catalog_index": number | null,    // number from the CATALOG below if it matches by meaning (any language), else null
      "notes": string | null,
      "sets": [
        { "reps": number|null, "weight": number|null, "rpe": number|null, "rest_sec": number|null, "notes": string|null }
      ]
    }
  ]
}
Rules:
- "4x8" → 4 sets of 8 reps. A weight or %1RM goes into "weight".
- "120*8*3" → 3 sets of 8 reps at weight 120. "60*15" → 1 set of 15 reps at weight 60.
- If reps are a range (8-10), use the lower bound.
- Keep "name" verbatim (do not translate). Match against the catalog by meaning, including
  Ukrainian/Russian/English synonyms; set catalog_index to that number, else null.
- rpe is 1..10 or null. rest_sec in seconds or null. Never invent data not present.
- Output valid JSON only, no markdown, no commentary.`;

type ParsedSet = {
  reps: number | null;
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
type Parsed = { title: string; exercises: ParsedExercise[] };

type CatalogItem = { id: string; name_en: string; name_uk: string };

function safeParse(text: string): Parsed {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t) as Parsed;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

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

    // ИИ через гейтвей (роут program_import → GPT-5.4 mini по умолчанию)
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

    const exercises = Array.isArray(parsed.exercises) ? parsed.exercises : [];
    if (exercises.length === 0) return json({ error: 'no_exercises' }, 422);

    // создать программу
    const { data: program, error: pErr } = await admin
      .from('programs')
      .insert({ user_id: userId, title: parsed.title?.slice(0, 200) || 'Imported program', source: 'ai_import' })
      .select('id')
      .single();
    if (pErr) return json({ error: pErr.message }, 500);

    let created = 0; // сколько новых кастомных упражнений завели

    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const name = (ex.name ?? '').trim().slice(0, 200);
      if (!name) continue;

      // 1) сопоставление от ИИ (индекс в каталоге)
      let exerciseId: string | null = null;
      const idx = num(ex.catalog_index);
      if (idx != null && idx >= 1 && idx <= catalog.length) {
        exerciseId = catalog[idx - 1].id;
      }

      // 2) фолбэк: прямое совпадение по имени
      if (!exerciseId) {
        const safe = name.replace(/[(),{}*%]/g, ' ').trim();
        if (safe) {
          const { data: m } = await admin
            .from('exercises')
            .select('id')
            .or(`owner_id.eq.${userId},is_global.eq.true`)
            .or(`name_en.ilike.${safe},name_uk.ilike.${safe}`)
            .limit(1)
            .maybeSingle();
          exerciseId = m?.id ?? null;
        }
      }

      // 3) нет в каталоге → заводим кастомное упражнение пользователя (станет доступно везде)
      if (!exerciseId) {
        const { data: newEx, error: cErr } = await admin
          .from('exercises')
          .insert({ owner_id: userId, name_en: name, name_uk: name, is_global: false })
          .select('id')
          .single();
        if (cErr) return json({ error: cErr.message }, 500);
        exerciseId = newEx.id;
        created++;
      }

      const { data: pe, error: peErr } = await admin
        .from('program_exercises')
        .insert({
          program_id: program.id,
          exercise_id: exerciseId,
          name,
          order_index: i,
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
          target_weight: weightToKg(num(s.weight)),
          target_rpe: num(s.rpe),
          rest_sec: num(s.rest_sec),
          notes: s.notes ?? null,
        }));
        const { error: sErr } = await admin.from('program_sets').insert(rows);
        if (sErr) return json({ error: sErr.message }, 500);
      }
    }

    return json({
      program_id: program.id,
      exercise_count: exercises.length,
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
