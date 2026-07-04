// Принимает текст расписания → ИИ раскладывает на блоки (кола/EMOM/суперсеты)
// и упражнения/подходы → пишет в programs. Файлы/клипы не храним, только структуру.
// Матчинг с каталогом: ИИ сам сопоставляет упражнение со списком (по смыслу, любой язык);
// чего нет в каталоге — заводим как кастомное упражнение пользователя.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { runIntent } from '../_shared/ai/gateway.ts';
import { AiError } from '../_shared/ai/types.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { hasAiAccess } from '../_shared/roles.ts';

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
            { "reps": number|null, "duration_sec": number|null, "weight": number|null, "rpe": number|null,
              "rest_sec": number|null, "gripper": string|null, "rgc": number|null,
              "set_type": "tns"|"card"|"block_38"|"block_20"|"deep"|null, "notes": string|null }
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
  exercise and not dropped. Put the per-set load into the set's weight; the gripper model goes
  into the set's "gripper" field; other non-numeric descriptors (band colour, "per side") → notes.
- GRIPPERS / hand-closers ("эспандер", "гриппер", "Heavy Grips 300", "CoC #2", "expander"): the load is
  the gripper MODEL, NOT a weight. → name the exercise "Стиснення еспандера" (catalog gripper), ONE set
  per gripper line with weight=null, reps=the closes ("на 3 раза" → reps 3), "gripper"=the model string
  ("Heavy Grips 300"), and "set_type" if a grip setup is named ("дипсет"/"дип-сет"/"діпсет"/"діп-сет"→"deep", "TNS"→"tns",
  "карта"→"card", "блок 38"→"block_38", "блок 20"→"block_20"). An "RGC"/"ргц" number ("72 rgc",
  "47 RGC") is the gripper's measured load → put it in the set "rgc" field as a NUMBER, NEVER in
  "weight", NEVER only in "notes". It is how same-model grippers of different strength are told apart
  (a "Heavy Grips 300" at 72 vs at 74 are two different tools). KEEP the colour/identifier ("blue",
  "black", "Gods of Grip", "Temu", "filed") INSIDE the "gripper" model string too — do NOT strip it.
  Three grippers ×5/×2/×4 → one exercise, three sets, three "gripper" values.
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
  gripper: string | null;   // модель эспандера ("Heavy Grips 300") — для grip-подходов; вес=null
  rgc: number | null;       // замеренная нагрузка эспандера (кг) — различает одномодельные грипперы
  set_type: string | null;  // установка гриппера: tns|card|block_38|block_20|deep
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

type CatalogItem = { id: string; name_en: string; name_uk: string; log_kind: string | null };

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

    // роль-гейт: ИИ-импорт только для full/admin (комьюнити-роль grip — без ИИ)
    if (!(await hasAiAccess(admin, userId))) return json({ error: 'feature_not_available' }, 403);

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
      .select('id, name_en, name_uk, log_kind')
      .or(`owner_id.eq.${userId},is_global.eq.true`)
      .order('name_en');
    const catalog: CatalogItem[] = (catRows ?? []) as CatalogItem[];
    // каноническое гриппер-упражнение (предпочесть «сжатие», не «удержание»)
    const gripperEx =
      catalog.find((c) => c.log_kind === 'gripper' && /close|стиснення/i.test(`${c.name_en} ${c.name_uk}`)) ??
      catalog.find((c) => c.log_kind === 'gripper') ??
      null;

    // каталог эспандеров (свои + глобальные) для резолва gripper_id по модели из текста
    // (резолвер — копия workout-import дня-43: двунаправленный subset токенов + гомоглифы + ближайший RGC)
    const { data: gripRows } = await admin
      .from('grippers')
      .select('id, brand, name, rgc, rgc_unit, owner_id')
      .or(`owner_id.eq.${userId},is_global.eq.true`);
    type GripRow = {
      id: string; brand: string | null; name: string;
      rgc: number | null; rgc_unit: string | null; owner_id: string | null;
    };
    // личные эспандеры — первыми: при равной близости по RGC берём личный, а не глобальный из чарта
    const grippers: GripRow[] = ((gripRows ?? []) as GripRow[]).sort(
      (a, b) => (a.owner_id ? 0 : 1) - (b.owner_id ? 0 : 1),
    );
    const SET_TYPES = ['tns', 'card', 'block_38', 'block_20', 'deep'];
    // кириллические гомоглифы → латиница: юзер пишет «СоС 3», каталог — «CoC #3»
    const HOMO: Record<string, string> = {
      а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
    };
    const gripNorm = (s: string) =>
      s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/[а-я]/g, (c) => HOMO[c] ?? c);
    const gripTokens = (s: string) => gripNorm(s).split(' ').filter(Boolean);
    const subset = (a: string[], b: string[]) => a.length > 0 && a.every((t) => b.includes(t));
    const rgcKg = (g: GripRow) =>
      g.rgc == null ? null : g.rgc_unit === 'lb' ? g.rgc * 0.453592 : g.rgc;
    const resolveGripperId = (model: string, rgc: number | null): string | null => {
      const mt = gripTokens(model);
      if (!mt.length) return null;
      const matches = grippers.filter((g) => {
        const gt = gripTokens(`${g.brand ?? ''} ${g.name}`);
        return subset(mt, gt) || subset(gt, mt);
      });
      if (!matches.length) return null;
      if (rgc == null) return matches[0].id; // grippers отсортирован: личные первыми
      let best = matches[0];
      let bestDiff = Infinity;
      for (const g of matches) {
        const gk = rgcKg(g);
        const diff = gk == null ? Infinity : Math.abs(gk - rgc);
        // строго ближе ИЛИ так же близко, но личный важнее глобального (best стартует с личного)
        if (diff < bestDiff || (diff === bestDiff && !!g.owner_id && !best.owner_id)) {
          best = g;
          bestDiff = diff;
        }
      }
      return best.id;
    };

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
      const setFields = (s: ParsedSet, fallbackNote: string | null = null) => {
        const isGripSet = !!str(s.gripper);
        const gripRgc = num(s.rgc);
        const gripperId = isGripSet ? resolveGripperId(s.gripper!, gripRgc) : null;
        const setType = SET_TYPES.includes(s.set_type ?? '') ? s.set_type : null;
        // meta доживает до тренировки: buildWorkoutFromProgram копирует ps.meta в сет как есть
        const meta: Record<string, unknown> = {};
        if (gripperId) meta.gripper_id = gripperId;
        else if (isGripSet) {
          // модель не сматчилась на каталог — НЕ теряем её: сохраняем сырьё в мете
          meta.gripper_model = str(s.gripper);
          if (gripRgc != null) meta.gripper_rgc = gripRgc;
        }
        if (setType) meta.set_type = setType;
        return {
          target_reps: num(s.reps),
          target_duration_sec: num(s.duration_sec),
          // у гриппера нагрузка = модель (gripper_id), не вес → weight всегда null
          target_weight: isGripSet ? null : weightToKg(num(s.weight)),
          target_rpe: num(s.rpe),
          rest_sec: num(s.rest_sec),
          notes: s.notes ?? fallbackNote ?? null,
          meta: Object.keys(meta).length ? meta : null,
        };
      };

      // один и тот же снаряд подряд (эспандер на разных грипперах, повтор строки) — это ДОП.
      // ПОДХОДЫ, а не новые упражнения. Дописываем их в предыдущее упражнение блока.
      let lastPeId: string | null = null;
      let lastExId: string | null = null;
      let lastSetCount = 0;

      for (let ei = 0; ei < exs.length; ei++) {
        const ex = exs[ei];
        // гриппер-упражнение (подходы несут модель эспандера) → каноническое «Стиснення еспандера»
        // с log_kind='gripper', а не кастомное упр. по тексту юзера (иначе грип-UI/рекорды не подхватят)
        const isGripperEx = !!gripperEx && (ex.sets ?? []).some((s) => str(s.gripper));
        const name = (isGripperEx ? gripperEx!.name_uk : ex.name ?? '').trim().slice(0, 200);
        if (!name) continue;

        const exerciseId = isGripperEx ? gripperEx!.id : await resolveExerciseId(ex);
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
