// Импорт ПРОШЛОЙ тренировки (постфактум, из блокнота): текст с датой → ИИ раскладывает на
// упражнения/подходы/стороны → создаём СРАЗУ ЗАВЕРШЁННУЮ тренировку (все подходы отмечены,
// длительность — адекватная оценка по объёму, а не время тыканья галочек).
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

const SYSTEM = `You transcribe a ALREADY-PERFORMED strength/armwrestling training session (from the
user's notebook) into structured JSON, mapping each exercise to a provided catalog. Everything here
WAS done — these are real performed sets, not a plan.

Extract the session DATE if present ("День 8. 23.05.2026" → "2026-05-23"; "23.05" → that day this
year). Format YYYY-MM-DD, else null.

Group exercises into BLOCKS exactly like a program: "single" = one standalone exercise; "superset" =
exercises done together/alternating; "rounds"/"emom"/"e2mom"/"amrap"/"for_time"/"interval" as stated.

ONE ITEM = ONE EXERCISE: a numbered/bulleted heading ("1.", "2.", "- ", "Натяжка ...:") is a SINGLE
exercise; EVERY set-line beneath it until the next heading belongs to that SAME exercise. Dynamic
(reps) and static (seconds) sets mixed in one exercise are normal and correct — e.g. "Натяжка с нижнего
блока: 25*12 обе; 28 статика правая 26,22с, левая 2*22с" is ONE exercise with 5 sets (1 reps + 4 time).
Do NOT spin off a second exercise just because some sets are statics/holds or carry a technique note
("через кисть"). A trailing sub-movement of the same item ("+ с той же позиции работа конусом ... по 1
подходу на каждую") = EXTRA sets of that same exercise.
An equipment/assist descriptor joined with "+" to a movement name ("Сгибание кисти ... + резинка
пронации", "+ резиной", "+ гумка") is the SAME exercise done with that aid — NEVER a separate
"резинка ..." exercise, and never an extra empty set. Keep the movement name CLEAN ("Сгибание кисти
ручкой на лямках"), and move the aid into the exercise "notes" ("резинка через пронацію"), not the name.
A movement with no weight/reps numbers is STILL one set, never zero: "подконтрольно красиво" → 1 set
(weight from context, reps null); never drop it. "по 1 подходу на каждую/each" = EXACTLY 2 sets, one
side="right" + one side="left", weight/reps null (a "1 подход" is a SET count, NEVER reps=1). So "Бок: 16 кг подконтрольно красиво + работа конусом
по 1 подходу на каждую" → 3 sets: [16, reps null] + [right, null] + [left, null]. NEVER output an
exercise with an empty sets array, and NEVER drop a movement the user wrote down.
SPLIT into a SUPERSET of several exercises ONLY when the text explicitly alternates NAMED movements:
"чередуя с …"/"alternating with", per-set movement tags on EVERY set ("(кисть)" vs "(відведення)"), or
"Н:/П:" exercise labels. Plain statics with no such alternation marker are NOT a split.
When sets carry alternating movement tags, build a superset of EXACTLY those tagged movements and route
EACH set to the ONE exercise its own tag names — every "(кисть)" set into the кисть exercise, every
"(відведення)/(отведение)" set into the відведення exercise. NEVER place a set under both, NEVER leave
the alternation interleaved inside one exercise, NEVER duplicate the same sets as a separate exercise.
Worked example: "22.25*12 (кисть), 22.5*3 (отведение), 26.25*10 (кисть), 26.25*3 (отведение), 32.25*6
(кисть), 32.25*3 (отведение), 29.25*10 (кисть)" → кисть = [22.25×12, 26.25×10, 32.25×6, 29.25×10],
отведение = [22.5×3, 26.25×3, 32.25×3]. Each set keeps its OWN weight×reps — never swap reps between the
two movements (26.25 was ×10 under кисть but ×3 under отведение).
A trailing static block ("28 статика (правая 24, левая 26)") with no tag belongs to the FIRST/main
movement of the superset (the one the статика was performed on), not a new exercise.

Return ONLY JSON:
{
  "date": "YYYY-MM-DD"|null,
  "title": string,                      // SHORT, e.g. "Кисть + пронація", "Натяжка"
  "session_note": string|null,          // warm-up / cool-down / finishers WITHOUT numbers, short
  "blocks": [
    {
      "type": "single|superset|rounds|emom|e2mom|amrap|for_time|interval",
      "label": string|null,
      "exercises": [
        {
          "name": string,               // the USER'S OWN wording, cleaned of numbers; NEVER renamed to a catalog entry
          "catalog_index": number|null, // catalog number if clearly the SAME movement, else null
          "notes": string|null,
          "sets": [
            { "reps": number|null, "duration_sec": number|null, "weight": number|null,
              "rpe": number|null, "side": "left"|"right"|"both"|null, "cheat": boolean|null,
              "gripper": string|null, "rgc": number|null,
              "set_type": "tns"|"card"|"block_38"|"block_20"|"deep"|null,
              "notes": string|null }
          ]
        }
      ]
    }
  ]
}

SIDES — set "side" ONLY when the text says so explicitly; NEVER infer it from the exercise or from a
multiplier:
- "обе"/"обидві"/"both"/"25*12 обе" → ONE set side="both" (volume counts double).
- Per-hand sides are keyed on the LEFT marker being present: "ліва/левая/Л:" = left,
  "права/правая/П:" = right. Treat single letters "Л:/П:" as sides ONLY when an "Л" (left) marker is
  actually present. e.g. "Л: 20*10, П: 20*7" → one left set + one right set; "32.25*6 (ліва 7)" /
  "права 24с, ліва 26с" → separate right & left sets.
- A LIST of values after ONE side marker = one set PER value on that side, never collapse them:
  "права 26, 22 с" → right 26s + right 22s; "ліва 2*22 с" → two left sets of 22s. So "2 подхода,
  правая 26, 22 секунди, левая 2*22 секунди" → right[26s, 22s] + left[22s, 22s] = 4 sets.
- Anything else (including a "*2"/"x2" multiplier) → side=null.
- SINGLE-ARM movements — the exercise itself is one-handed ("на одній руці"/"на одной (руке)"/
  "однією рукою"/"one-arm"/"single-arm"), OR a "на кожну/каждую руку"/"each arm"/"по N на руку"
  instruction is present → ALWAYS split per hand: emit side="right" AND side="left" sets, NEVER
  side="both". "N підходів по R раз(ів) на кожну руку" → N right sets of R reps + N left sets of R reps.
  e.g. "Підтягування на одній, два підходи по 1 разу на кожну руку" → right×1, right×1, left×1, left×1.

SUPERSET LABELS ARE NOT SIDES: short letters/numbers that NAME the exercises of a superset — e.g.
"Н:" (Натяжка) + "П:" (Пронація), or "1." / "2." — are EXERCISE labels, NOT sides. Keep them as
SEPARATE exercises inside ONE superset block. NEVER merge a superset into a single exercise, and NEVER
turn "Н:"/"П:" exercise labels into left/right. (Sides need an "Л"/"ліва"/"права" word present.)

WARM-UP / COOL-DOWN / FINISHERS WITHOUT NUMBERS ("+ концентрична робота з резиною на пронацію в
заминці", "розминка ...") → do NOT create an exercise. Summarise them in "session_note". Create an
exercise ONLY when it has real numbers (weight/reps/seconds).

OTHER RULES:
- Set multipliers ALWAYS expand into that many separate sets with side=null — never a side, never an
  "xN" note. "26.25*10*2" → TWO sets of 26.25 × 10. "120*8*3" → three sets of 120 × 8.
- Weights "26.25", "32.25 кг", ranges "22.5-25" → number into weight (range → lower bound). "bar/палку
  considered as base" — keep the stated number.
- Time holds / statics ("28 статика", "22 секунди") → reps null, seconds into duration_sec.
- CHEAT: a set done in a cheating/looser form sets "cheat": true. In particular "с согнутой кисти" /
  "зігнутою кистю" (bent-wrist rep) → cheat true (keep the phrase in that set's "notes" too). Otherwise
  cheat null/false.
- A weight/"статика" line that introduces per-side values is a HEADER, not a set — emit ONLY the listed
  values as sets at that weight, and NEVER an extra set for the bare "статика"/"N подходов" token. Works
  for BOTH formats: "28 статика. 2 подхода, правая 26 и 22с, левая 2*22с" → 4 sets (right 26s, right 22s,
  left 22s, left 22s); "28*статика (правая 24, левая 26)" → EXACTLY 2 sets (right 24s, left 26s), no
  third "28×?" set. "N подходов/подхода" is a COUNT of the sets that follow, never an additional set.
- "10 тяг (30 кг)" → 1 set reps 10 weight 30. Reps range (8-10) → lower bound. rpe 1..10 or null.
- GRIPPERS / hand-closers ("эспандер", "гриппер", "Heavy Grips 300", "CoC #2", "expander"): the load is
  the gripper MODEL, NOT a weight. → name the exercise "Стиснення еспандера" (catalog gripper), ONE set
  per gripper line with weight=null, reps=the closes ("на 3 раза" → reps 3), "gripper"=the model string
  ("Heavy Grips 300"), and "set_type" if a grip setup is named ("дипсет"/"дип-сет"→"deep", "TNS"→"tns",
  "карта"→"card", "блок 38"→"block_38", "блок 20"→"block_20"). An "RGC"/"ргц" number ("72 rgc",
  "47 RGC") is the gripper's measured load → put it in the set "rgc" field as a NUMBER, NEVER in
  "weight", NEVER only in "notes". It is how same-model grippers of different strength are told apart
  (a "Heavy Grips 300" at 72 vs at 74 are two different tools). KEEP the colour/identifier ("blue",
  "black", "Gods of Grip", "Temu", "filed") INSIDE the "gripper" model string too — do NOT strip it.
- "name" excludes leading narration verbs ("Поделал"/"Сделал"/"Делал"/"Поробив"/"Did") — keep only the
  movement itself: "Поделал сгибание кисти ручкой на лямках" → "Сгибание кисти ручкой на лямках".
- catalog_index ONLY when clearly the same movement AND equipment; else null (saved as user's own).
  Do NOT map to a DIFFERENT-named entry by mere similarity: "Бок"/"боковое"/"бокове" (side pressure) is
  NOT "Натяжка через відведення" (abduction pull). Map a "відведення/отведение" movement ONLY when that
  word actually appears in the text for that exercise; otherwise keep the user's own name, index null.
- WRIST-FLEXION SIDE PULL is ONE catalog movement "Натяжка через кисть": "натяжка через кисть",
  "через кисть", "натяжка кистю/кистью", AND "натяжка з нижнього блока"/"з нижнього блока"/"нижній блок"
  (ru "с нижнего блока"/"нижний блок") ALL map to it — same exercise on the lower cable. (Still distinct
  from "через відведення" abduction pull and "Бок" side pressure above.)
- Output valid JSON only, no markdown.`;

type PSet = {
  reps: number | null;
  duration_sec: number | null;
  weight: number | null;
  rpe: number | null;
  side: 'left' | 'right' | 'both' | null;
  cheat: boolean | null;
  gripper: string | null;   // модель эспандера ("Heavy Grips 300") — для grip-подходов; вес=null
  rgc: number | null;       // замеренная нагрузка эспандера (кг) — различает одномодельные грипперы
  set_type: string | null;  // установка гриппера: tns|card|block_38|block_20|deep
  notes: string | null;
};
type PEx = { name: string; catalog_index: number | null; notes: string | null; sets: PSet[] };
type PBlock = { type: string | null; label: string | null; exercises: PEx[] };
type Parsed = { date: string | null; title: string; blocks: PBlock[] };
type CatalogItem = { id: string; name_en: string; name_uk: string; log_kind: string | null };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function safeParse(text: string): Parsed {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t) as Parsed;
}

// Предохранитель от явного бреда поверх смыслового матча модели: терпим к опечаткам/
// коротким/слитным словам (жемлёжа → Жим лёжа), иначе верный матч отклоняется и
// плодятся дубль-кастомы; но «млин з гирею» ↔ «турецький підйом» остаётся непохожим.
function normName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function tokens(s: string): string[] {
  return normName(s).split(' ').filter((w) => w.length >= 3);
}
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
  const na = normName(a).replace(/ /g, '');
  const nb = normName(b).replace(/ /g, '');
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  if (ta.length === 0 || tb.length === 0) {
    if (!na || !nb) return false;
    return editDistance(na, nb) <= Math.max(1, Math.floor(Math.max(na.length, nb.length) / 4));
  }
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

    // роль-гейт: ИИ-импорт только для full/admin (комьюнити-роль grip — без ИИ)
    if (!(await hasAiAccess(admin, userId))) return json({ error: 'feature_not_available' }, 403);

    const { data: prof } = await admin.from('profile').select('units').eq('user_id', userId).maybeSingle();
    const userUnit = prof?.units === 'lb' ? 'lb' : 'kg';
    const LB_PER_KG = 2.2046226218;
    const toKg = (w: number | null): number | null =>
      w == null ? null : userUnit === 'lb' ? w / LB_PER_KG : w;

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
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/[а-я]/g, (c) => HOMO[c] ?? c);
    const gripTokens = (s: string) => norm(s).split(' ').filter(Boolean);
    const subset = (a: string[], b: string[]) => a.length > 0 && a.every((t) => b.includes(t));
    const rgcKg = (g: GripRow) =>
      g.rgc == null ? null : g.rgc_unit === 'lb' ? g.rgc * 0.453592 : g.rgc;
    // Резолв модели из текста на гриппер каталога (личные в приоритете). Имя матчится, если набор
    // токенов одного ⊆ другого В ЛЮБУЮ сторону: «heavy grips 200» ⊆ «heavy grips 200 temu» И наоборот;
    // «coc 3» = «coc 3» после фолда «#»/кириллицы. Среди совпадений по имени РАЗЛИЧАЕМ по RGC — берём
    // ближайший к указанному (две CoC #2.5 56/59; три Heavy Grips 300 74/72/72). Без RGC — первый личный.
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
        // разминка/заминка/добивка без чисел — сюда (а не пустыми упражнениями)
        notes: str(parsed.session_note)?.slice(0, 1000) ?? null,
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
      // упражнение без единого подхода (без чисел) не создаём — оно уходит в session_note
      const exs = (b.exercises ?? []).filter((e) => str(e.name) && (e.sets?.length ?? 0) > 0);
      if (!exs.length) continue;
      const cluster = isCluster(b.type ?? null);
      const blockKey = cluster ? crypto.randomUUID() : null;

      for (const ex of exs) {
        // гриппер-упражнение (подходы несут модель эспандера) → каноническое «Стиснення еспандера»
        // с log_kind='gripper', а не кастомное упр. по тексту юзера (иначе грип-UI/рекорды не подхватят)
        const isGripperEx = !!gripperEx && (ex.sets ?? []).some((s) => str(s.gripper));
        const exerciseId = isGripperEx ? gripperEx!.id : await resolveId(ex);
        if (!exerciseId) continue;
        exerciseCount++;
        const { data: we, error: weErr } = await admin
          .from('workout_exercises')
          .insert({
            workout_id: workout.id,
            exercise_id: exerciseId,
            order_index: order++,
            display_name: (isGripperEx ? gripperEx!.name_uk : ex.name).trim().slice(0, 200),
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
            const cheat = s.cheat === true;
            const isGripSet = !!str(s.gripper);
            const gripRgc = num(s.rgc);
            const gripperId = isGripSet ? resolveGripperId(s.gripper!, gripRgc) : null;
            const setType = SET_TYPES.includes(s.set_type ?? '') ? s.set_type : null;
            const meta: Record<string, unknown> = {};
            if (side) meta.side = side;
            if (cheat) meta.cheat = true;
            if (gripperId) meta.gripper_id = gripperId;
            else if (isGripSet) {
              // модель не сматчилась на каталог — НЕ теряем её: сохраняем сырьё в мете
              meta.gripper_model = str(s.gripper);
              if (gripRgc != null) meta.gripper_rgc = gripRgc;
            }
            if (setType) meta.set_type = setType;
            return {
              workout_exercise_id: we.id,
              // у гриппера нагрузка = модель (gripper_id), не вес → weight всегда null
              weight: isGripSet ? null : toKg(num(s.weight)),
              reps: num(s.reps),
              duration_sec: num(s.duration_sec),
              rpe: num(s.rpe),
              logged_at: endedAt.toISOString(),
              meta: Object.keys(meta).length ? meta : null,
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
