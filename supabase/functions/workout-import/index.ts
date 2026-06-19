// Импорт ПРОШЛОЙ тренировки (постфактум, из блокнота): текст с датой → ИИ раскладывает на
// упражнения/подходы/стороны → создаём СРАЗУ ЗАВЕРШЁННУЮ тренировку (все подходы отмечены,
// длительность — адекватная оценка по объёму, а не время тыканья галочек).
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

const SYSTEM = `You transcribe a ALREADY-PERFORMED strength/armwrestling training session (from the
user's notebook) into structured JSON, mapping each exercise to a provided catalog. Everything here
WAS done — these are real performed sets, not a plan.

Extract the session DATE if present ("День 8. 23.05.2026" → "2026-05-23"; "23.05" → that day this
year). Format YYYY-MM-DD, else null.

Group exercises into BLOCKS exactly like a program: "single" = one standalone exercise; "superset" =
exercises done together/alternating; "rounds"/"emom"/"e2mom"/"amrap"/"for_time"/"interval" as stated.

Return ONLY JSON:
{
  "date": "YYYY-MM-DD"|null,
  "title": string,                      // SHORT, e.g. "Кисть + пронація", "Натяжка"
  "blocks": [
    {
      "type": "single|superset|rounds|emom|e2mom|amrap|for_time|interval",
      "label": string|null,
      "exercises": [
        {
          "name": string,               // CLEAN base movement, do not translate, strip numbers
          "catalog_index": number|null, // catalog number if clearly the SAME movement, else null
          "notes": string|null,
          "sets": [
            { "reps": number|null, "duration_sec": number|null, "weight": number|null,
              "rpe": number|null, "side": "left"|"right"|"both"|null, "notes": string|null }
          ]
        }
      ]
    }
  ]
}

SIDES (important for armwrestling):
- Same weight done on BOTH hands → ONE set with side="both" (volume counts double automatically).
- Different per-side numbers ("32.25*6 (ліва 7)", "права 24с, ліва 26с") → TWO sets:
  side="right" and side="left" with their own reps/seconds.
- Plain bilateral lift (no per-hand notion) → side=null.

OTHER RULES:
- Set multipliers expand into separate sets: "26.25*10*2" → in a per-hand context this is side="both"
  (both hands ×10); otherwise → two sets. Never output "xN" as a note.
- Weights "26.25", "32.25 кг", ranges "22.5-25" → number into weight (range → lower bound). "bar/палку
  considered as base" — keep the stated number.
- Time holds / statics ("28 статика", "22 секунди") → reps null, seconds into duration_sec.
- "10 тяг (30 кг)" → 1 set reps 10 weight 30. Reps range (8-10) → lower bound. rpe 1..10 or null.
- catalog_index ONLY when clearly the same movement AND equipment; else null (saved as user's own).
- Output valid JSON only, no markdown.`;

type PSet = {
  reps: number | null;
  duration_sec: number | null;
  weight: number | null;
  rpe: number | null;
  side: 'left' | 'right' | 'both' | null;
  notes: string | null;
};
type PEx = { name: string; catalog_index: number | null; notes: string | null; sets: PSet[] };
type PBlock = { type: string | null; label: string | null; exercises: PEx[] };
type Parsed = { date: string | null; title: string; blocks: PBlock[] };
type CatalogItem = { id: string; name_en: string; name_uk: string };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function safeParse(text: string): Parsed {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t) as Parsed;
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 4);
}
function namesResemble(a: string, b: string): boolean {
  const tb = tokens(b);
  for (const x of tokens(a)) for (const y of tb) if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  return false;
}

// кластер (суперсет/коло/EMOM) рендерится группой; «single» — отдельными карточками
const isCluster = (type: string | null): boolean => !!type && type !== 'single';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_authorization' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const { text } = await req.json().catch(() => ({ text: '' }));
    if (!text || typeof text !== 'string' || text.trim().length < 3) return json({ error: 'empty_input' }, 400);

    const admin = createClient(url, serviceKey);

    const { data: prof } = await admin.from('profile').select('units').eq('user_id', userId).maybeSingle();
    const userUnit = prof?.units === 'lb' ? 'lb' : 'kg';
    const LB_PER_KG = 2.2046226218;
    const toKg = (w: number | null): number | null =>
      w == null ? null : userUnit === 'lb' ? w / LB_PER_KG : w;

    const { data: catRows } = await admin
      .from('exercises')
      .select('id, name_en, name_uk')
      .or(`owner_id.eq.${userId},is_global.eq.true`)
      .order('name_en');
    const catalog: CatalogItem[] = (catRows ?? []) as CatalogItem[];
    const catalogBlock = catalog.map((c, i) => `${i + 1}. ${c.name_en} / ${c.name_uk}`).join('\n');

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
    if (!blocks.length) return json({ error: 'no_exercises' }, 422);

    // дата → started_at (полдень UTC, чтобы не съезжал день по таймзоне); длительность — оценка
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date ?? '')
      ? parsed.date!
      : new Date().toISOString().slice(0, 10);
    const totalSets = blocks.reduce(
      (n, b) => n + (b.exercises ?? []).reduce((m, e) => m + (e.sets?.length ?? 0), 0),
      0,
    );
    const estMin = Math.min(120, Math.max(8, Math.round(5 + totalSets * 2.5)));
    const startedAt = new Date(`${ymd}T12:00:00.000Z`);
    const endedAt = new Date(+startedAt + estMin * 60000);

    const { data: workout, error: wErr } = await admin
      .from('workouts')
      .insert({
        user_id: userId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        title: str(parsed.title)?.slice(0, 120) ?? null,
        notes: 'imported',
      })
      .select('id')
      .single();
    if (wErr) return json({ error: wErr.message }, 500);

    // матчинг по каталогу (индекс → проверка похожести → ilike → создать кастом)
    const resolveId = async (ex: PEx): Promise<string | null> => {
      const name = (ex.name ?? '').trim().slice(0, 200);
      if (!name) return null;
      const idx = num(ex.catalog_index);
      if (idx != null && idx >= 1 && idx <= catalog.length) {
        const c = catalog[idx - 1];
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
      const { data: created, error } = await admin
        .from('exercises')
        .insert({ owner_id: userId, name_en: name, name_uk: name, is_global: false })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return created.id;
    };

    // собираем упражнения и подходы (всё «выполнено»: logged_at/done_at = конец сессии)
    let order = 0;
    let exerciseCount = 0;
    for (const b of blocks) {
      const exs = (b.exercises ?? []).filter((e) => str(e.name));
      if (!exs.length) continue;
      const cluster = isCluster(b.type ?? null);
      const blockKey = cluster ? crypto.randomUUID() : null;

      for (const ex of exs) {
        const exerciseId = await resolveId(ex);
        if (!exerciseId) continue;
        exerciseCount++;
        const { data: we, error: weErr } = await admin
          .from('workout_exercises')
          .insert({
            workout_id: workout.id,
            exercise_id: exerciseId,
            order_index: order++,
            display_name: ex.name.trim().slice(0, 200),
            done_at: endedAt.toISOString(),
            block_key: blockKey,
            block_label: cluster ? (str(b.label) ?? null) : null,
            block_type: cluster ? (b.type ?? null) : null,
          })
          .select('id')
          .single();
        if (weErr) return json({ error: weErr.message }, 500);

        const sets = Array.isArray(ex.sets) ? ex.sets : [];
        if (sets.length) {
          const rows = sets.map((s) => {
            const side = s.side === 'left' || s.side === 'right' || s.side === 'both' ? s.side : null;
            return {
              workout_exercise_id: we.id,
              weight: toKg(num(s.weight)),
              reps: num(s.reps),
              duration_sec: num(s.duration_sec),
              rpe: num(s.rpe),
              logged_at: endedAt.toISOString(),
              meta: side ? { side } : null,
            };
          });
          const { error: sErr } = await admin.from('sets').insert(rows);
          if (sErr) return json({ error: sErr.message }, 500);
        }
      }
    }

    if (exerciseCount === 0) {
      await admin.from('workouts').delete().eq('id', workout.id);
      return json({ error: 'no_exercises' }, 422);
    }

    return json({ workout_id: workout.id, date: ymd, exercise_count: exerciseCount, duration_min: estMin });
  } catch (e) {
    if (e instanceof AiError) {
      const code = e.code === 'budget_exceeded' ? 429 : 502;
      return json({ error: e.code, detail: e.message }, code);
    }
    return json({ error: 'server_error', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
