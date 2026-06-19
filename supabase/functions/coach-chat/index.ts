// ІІ-коуч (§3): агент с read-only SQL-инструментами над данными атлета.
// Модель сама решает, что запросить под вопрос → точно, дёшево, всегда свежо, без галлюцинаций.
// Контекст НЕ векторный — структурные данные тянем SQL. Долговременная память — coach_facts.
// Чат хранится в ai_threads/ai_messages. Бюджет/лимиты — через runIntent (на каждый вызов модели).
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { runIntent } from '../_shared/ai/gateway.ts';
import { AiError, ChatMessage, ContentBlock, ToolSpec } from '../_shared/ai/types.ts';
import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const LB_PER_KG = 2.2046226218;
const MAX_TOOL_TURNS = 5;
const HISTORY_LIMIT = 24;

// Фаза цикла по дню (1-based). Согласовано с клиентом (cycle.ts).
function cyclePhase(day: number): string | null {
  if (day < 1 || day > 40) return null;
  if (day <= 5) return 'menstrual';
  if (day <= 13) return 'follicular';
  if (day <= 16) return 'ovulation';
  return 'luteal';
}

const PERSONA = `You are the in-app strength & conditioning coach for this athlete. You are NOT a generic
chatbot — your value is that you have private, precise access to THIS athlete's real training and
recovery data via tools, and a long-term memory of them. Use it.

Voice: a sharp, supportive, no-nonsense coach. Encouraging but honest. Concise — answer like a coach
texting between sets, not an essay. Speak the athlete's language (uk or en, given below).

Hard rules:
- Ground every claim in real data. Call the tools to fetch workouts, lifts, recovery, cycle, records
  or saved facts BEFORE making data-specific statements. Never invent numbers.
- Recovery data (OURA) can be stale or missing. Tools return the data's date and age. For a
  "should I train today / am I recovered" type question, if the latest reading is not from today,
  SAY how old it is and reason accordingly — never present stale data as current.
- If the athlete tracks their cycle, factor the current phase into training/recovery advice. If they
  don't track it (or aren't female), don't bring it up.
- When you learn a durable fact about the athlete (goal, injury, constraint, strong preference),
  save it with remember_fact so you remember next time. Don't save trivia or one-off chatter.
- Don't prescribe medical treatment; for pain/injury, give training-side guidance and suggest a pro
  when warranted.
- Keep replies short and actionable. Use the athlete's units.
- Address the athlete with the CORRECT grammatical gender for their sex in the target language
  (e.g. Ukrainian "готова/готовий", "зробила/зробив"). The athlete's sex is given below.
- Be direct and supportive, but NEVER use profanity, slang slurs or vulgar language. Stay clean.
- Write fluent, natural language — no garbled phrases. If unsure of a word, rephrase.`;

const TOOLS: ToolSpec[] = [
  {
    name: 'get_profile',
    description:
      "The athlete's profile: units, language, sex, bodyweight, enabled disciplines, whether they track their menstrual cycle and whether OURA is connected.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_recent_workouts',
    description: 'Recent workout sessions with date, title and a short per-exercise summary.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Look-back window in days (default 21).' } },
    },
  },
  {
    name: 'get_exercise_history',
    description:
      'Logged sets for a specific exercise over time (by name, any language) — to judge progression.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Exercise name or fragment, e.g. "bench", "присід".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_records',
    description: "The athlete's personal records (best per exercise).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_recovery',
    description:
      'Recent OURA recovery snapshots (readiness, sleep, HRV, RHR, temp) WITH the date and age of the latest reading, so you can tell if it is fresh.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Look-back window in days (default 14).' } },
    },
  },
  {
    name: 'get_cycle',
    description:
      'Current menstrual cycle day and phase (only meaningful if the athlete tracks their cycle).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_facts',
    description: 'Durable facts you saved earlier about this athlete (goals, injuries, preferences).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'remember_fact',
    description:
      'Save a durable fact about the athlete for future sessions. Use sparingly for things worth remembering.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['goal', 'injury', 'constraint', 'preference', 'note'] },
        content: { type: 'string', description: 'The fact, one sentence.' },
      },
      required: ['content'],
    },
  },
];

// Тулзы исполняются на service-role, но ВСЕГДА скоупятся по userId.
function makeTools(admin: SupabaseClient, userId: string, units: 'kg' | 'lb') {
  const w = (kg: number | null): number | null =>
    kg == null ? null : Math.round((units === 'lb' ? kg * LB_PER_KG : kg) * 10) / 10;
  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const ageDays = (date: string) =>
    Math.floor((+today - +new Date(date + 'T00:00:00Z')) / 86400000);

  const tools: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    async get_profile() {
      const { data: p } = await admin
        .from('profile')
        .select(
          'units, language, gender, gender_self, bodyweight, height_cm, oura_connected, disciplines, track_cycle',
        )
        .eq('user_id', userId)
        .maybeSingle();
      return {
        units: p?.units ?? units,
        language: p?.language ?? 'en',
        sex: p?.gender ?? 'na',
        sex_self: p?.gender_self ?? null,
        bodyweight: w(p?.bodyweight ?? null),
        height_cm: p?.height_cm ?? null,
        oura_connected: !!p?.oura_connected,
        tracks_cycle: !!p?.track_cycle,
        disciplines: (p?.disciplines as string[] | null) ?? [],
      };
    },

    async get_recent_workouts(input) {
      const days = typeof input.days === 'number' ? input.days : 21;
      const since = ymd(new Date(+today - days * 86400000));
      const { data: ws } = await admin
        .from('workouts')
        .select(
          'id, started_at, ended_at, title, workout_exercises(display_name, exercise_id, exercises(name_en, name_uk), sets(weight, reps, duration_sec, logged_at, rpe))',
        )
        .eq('user_id', userId)
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(20);
      return (ws ?? []).map((wo) => ({
        date: wo.started_at?.slice(0, 10),
        title: wo.title ?? null,
        done: !!wo.ended_at,
        exercises: (wo.workout_exercises ?? [])
          .map((we) => {
            const done = (we.sets ?? []).filter((s) => s.logged_at);
            if (!done.length) return null;
            const name = we.exercises?.name_en ?? we.display_name ?? '—';
            const best = done.reduce(
              (b, s) => ((s.weight ?? 0) > (b?.weight ?? -1) ? s : b),
              null as null | { weight: number | null; reps: number | null },
            );
            return {
              name,
              sets: done.length,
              top: best?.weight != null ? `${w(best.weight)}${units} × ${best.reps ?? '?'}` : null,
            };
          })
          .filter(Boolean),
      }));
    },

    async get_exercise_history(input) {
      const query = String(input.query ?? '').trim();
      if (!query) return { error: 'empty query' };
      const like = `%${query}%`;
      const { data: exs } = await admin
        .from('exercises')
        .select('id, name_en, name_uk')
        .or(`owner_id.eq.${userId},is_global.eq.true`)
        .or(`name_en.ilike.${like},name_uk.ilike.${like}`)
        .limit(5);
      if (!exs?.length) return { matches: [], note: 'no exercise matched that name' };
      const ids = exs.map((e) => e.id);
      const { data: wes } = await admin
        .from('workout_exercises')
        .select('id, exercise_id, workouts!inner(user_id, started_at)')
        .in('exercise_id', ids)
        .eq('workouts.user_id', userId);
      const weByDate = new Map<string, string>(); // weId → date
      for (const we of wes ?? []) weByDate.set(we.id, we.workouts?.started_at?.slice(0, 10));
      const weIds = [...weByDate.keys()];
      if (!weIds.length) return { exercise: exs[0].name_en, sets: [] };
      const { data: sets } = await admin
        .from('sets')
        .select('workout_exercise_id, weight, reps, duration_sec, rpe, logged_at')
        .in('workout_exercise_id', weIds)
        .not('logged_at', 'is', null)
        .order('logged_at', { ascending: false })
        .limit(40);
      return {
        exercise: exs[0].name_en,
        sets: (sets ?? []).map((s) => ({
          date: weByDate.get(s.workout_exercise_id) ?? s.logged_at?.slice(0, 10),
          load: s.weight != null ? `${w(s.weight)}${units}` : null,
          reps: s.reps,
          sec: s.duration_sec,
          rpe: s.rpe,
        })),
      };
    },

    async get_records() {
      const { data: prs } = await admin
        .from('personal_records')
        .select('type, value, achieved_at, exercises(name_en, name_uk)')
        .eq('user_id', userId)
        .order('achieved_at', { ascending: false })
        .limit(40);
      if (!prs?.length) return { records: [], note: 'no records stored yet — derive from history if needed' };
      return {
        records: prs.map((r) => ({
          exercise: r.exercises?.name_en ?? '—',
          type: r.type,
          value: r.type.includes('weight') || r.type.includes('1rm') ? `${w(r.value)}${units}` : r.value,
          date: r.achieved_at?.slice(0, 10),
        })),
      };
    },

    async get_recovery(input) {
      const days = typeof input.days === 'number' ? input.days : 14;
      const since = ymd(new Date(+today - days * 86400000));
      const { data: snaps } = await admin
        .from('health_snapshots')
        .select('date, readiness, sleep_score, hrv, rhr, temp')
        .eq('user_id', userId)
        .gte('date', since)
        .order('date', { ascending: false })
        .limit(days);
      if (!snaps?.length) return { connected: false, note: 'no recovery data in range' };
      const latest = snaps[0];
      return {
        latest_date: latest.date,
        latest_age_days: ageDays(latest.date),
        is_fresh_today: ageDays(latest.date) === 0,
        snapshots: snaps.map((s) => ({
          date: s.date,
          readiness: s.readiness,
          sleep: s.sleep_score,
          hrv: s.hrv,
          rhr: s.rhr,
          temp: s.temp,
        })),
      };
    },

    async get_cycle() {
      const { data: p } = await admin
        .from('profile')
        .select('track_cycle')
        .eq('user_id', userId)
        .maybeSingle();
      if (!p?.track_cycle) return { tracks_cycle: false };
      const { data: starts } = await admin
        .from('cycle_periods')
        .select('start_date')
        .eq('user_id', userId)
        .lte('start_date', ymd(today))
        .order('start_date', { ascending: false })
        .limit(1);
      if (!starts?.length) return { tracks_cycle: true, note: 'no period start logged' };
      const day = ageDays(starts[0].start_date) + 1;
      return { tracks_cycle: true, cycle_day: day, phase: cyclePhase(day), last_start: starts[0].start_date };
    },

    async get_facts() {
      const { data: facts } = await admin
        .from('coach_facts')
        .select('kind, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      return { facts: (facts ?? []).map((f) => ({ kind: f.kind, content: f.content })) };
    },

    async remember_fact(input) {
      const content = String(input.content ?? '').trim().slice(0, 500);
      if (!content) return { ok: false, error: 'empty content' };
      const kind = ['goal', 'injury', 'constraint', 'preference', 'note'].includes(
        String(input.kind),
      )
        ? String(input.kind)
        : 'note';
      const { error } = await admin.from('coach_facts').insert({ user_id: userId, kind, content });
      return error ? { ok: false, error: error.message } : { ok: true };
    },
  };
  return tools;
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

    const { message } = await req.json().catch(() => ({ message: '' }));
    if (!message || typeof message !== 'string' || !message.trim()) {
      return json({ error: 'empty_input' }, 400);
    }

    const admin = createClient(url, serviceKey);

    // профиль (язык/единицы/пол/имя) — для persona, согласования рода и форматирования
    const { data: prof } = await admin
      .from('profile')
      .select('units, language, gender, gender_self, display_name')
      .eq('user_id', userId)
      .maybeSingle();
    const units: 'kg' | 'lb' = prof?.units === 'lb' ? 'lb' : 'kg';
    const lang = prof?.language === 'uk' ? 'uk' : 'en';
    const sex = prof?.gender ?? 'na';

    // один тред коуча на пользователя (берём последний, иначе создаём)
    let threadId: string;
    const { data: th } = await admin
      .from('ai_threads')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (th?.id) threadId = th.id;
    else {
      const { data: created, error: tErr } = await admin
        .from('ai_threads')
        .insert({ user_id: userId })
        .select('id')
        .single();
      if (tErr) return json({ error: tErr.message }, 500);
      threadId = created.id;
    }

    // история (для контекста разговора) + запись нового сообщения пользователя
    const { data: hist } = await admin
      .from('ai_messages')
      .select('role, content')
      .eq('thread_id', threadId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const history: ChatMessage[] = (hist ?? [])
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    await admin.from('ai_messages').insert({ thread_id: threadId, role: 'user', content: message.trim() });

    const who = prof?.display_name ? `name ${prof.display_name}, ` : '';
    const sexLabel = sex === 'other' && prof?.gender_self ? `other (${prof.gender_self})` : sex;
    const system =
      `${PERSONA}\n\nAthlete: ${who}sex ${sexLabel}, language ${lang}, units ${units}. ` +
      `Match grammatical gender to the sex above. Today: ${new Date().toISOString().slice(0, 10)}.`;
    const tools = makeTools(admin, userId, units);
    const messages: ChatMessage[] = [...history, { role: 'user', content: message.trim() }];

    // агент-цикл: модель → (tool_use → исполняем → tool_result → снова) → текст
    let reply = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let model = '';
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const out = await runIntent(admin, userId, 'coach_chat', {
        system,
        messages,
        tools: TOOLS,
        maxTokens: 1024,
      });
      tokensIn += out.tokensIn;
      tokensOut += out.tokensOut;
      model = out.model;

      if (out.stopReason === 'tool_use' && out.toolUses?.length) {
        // ассистент попросил инструменты — отражаем его ход (текст + tool_use блоки)
        const assistantBlocks: ContentBlock[] = [];
        if (out.text) assistantBlocks.push({ type: 'text', text: out.text });
        for (const tu of out.toolUses)
          assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        messages.push({ role: 'assistant', content: assistantBlocks });

        // исполняем каждый инструмент → tool_result
        const resultBlocks: ContentBlock[] = [];
        for (const tu of out.toolUses) {
          let result: unknown;
          try {
            const fn = tools[tu.name];
            result = fn
              ? await fn((tu.input ?? {}) as Record<string, unknown>)
              : { error: `unknown tool ${tu.name}` };
          } catch (e) {
            result = { error: e instanceof Error ? e.message : 'tool failed' };
          }
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: resultBlocks });
        continue;
      }

      reply = out.text.trim();
      break;
    }

    if (!reply) reply = lang === 'uk' ? 'Вибач, не вийшло відповісти. Спробуй ще раз.' : 'Sorry, I could not answer. Try again.';

    await admin.from('ai_messages').insert({
      thread_id: threadId,
      role: 'assistant',
      content: reply,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    });

    return json({ reply });
  } catch (e) {
    if (e instanceof AiError) {
      const code = e.code === 'budget_exceeded' ? 429 : 502;
      return json({ error: e.code, detail: e.message }, code);
    }
    return json({ error: 'server_error', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
