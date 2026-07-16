// Тянет дневные данные OURA (всё, что отдаёт v2) за диапазон и пишет снимок на КАЖДЫЙ день
// в health_snapshots (upsert по user_id+date → копится time-series для аналитики).
// Токен читается из private.oura_tokens через security-definer RPC (только service_role).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { hasPrivateAccess } from '../_shared/roles.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
// секунды → минуты (округляем); OURA отдаёт длительности в секундах
const min = (sec: unknown): number | null => {
  const n = num(sec);
  return n == null ? null : Math.round(n / 60);
};

type Row = Record<string, unknown>;
// документ OURA v2: у всех есть day; у sleep-периодов ещё type (long_sleep). Прочие поля — по эндпоинту.
type OuraDoc = { day?: string; type?: string; [k: string]: unknown };

/** Индекс «день → документ». Последний выигрывает; опц. предпочтение по предикату (long_sleep). */
function byDay<T extends { day?: string }>(arr: T[], prefer?: (t: T) => boolean): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of arr) {
    if (!it?.day) continue;
    const cur = m.get(it.day);
    if (!cur) m.set(it.day, it);
    else if (prefer && prefer(it) && !prefer(cur)) m.set(it.day, it);
  }
  return m;
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

    const admin = createClient(url, serviceKey);
    if (!(await hasPrivateAccess(admin, userId))) return json({ error: 'forbidden' }, 403);
    const { data: token, error: tokErr } = await admin.rpc('get_oura_token', { p_user: userId });
    if (tokErr) return json({ error: tokErr.message }, 500);
    if (!token) return json({ error: 'not_connected' }, 400);

    // диапазон бэкафилла (по умолчанию 30 дней; body.days до ~5.5 лет для разовой полной истории)
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body?.days) || 30, 1), 2000);
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    // end_date = завтра: OURA трактует границу так, что сегодняшний день иначе может «выпасть»
    const endParam = new Date(end.getTime() + 86400000);
    const range = `start_date=${ymd(start)}&end_date=${ymd(endParam)}`;
    const headers = { Authorization: `Bearer ${token}` };

    // тянем всё, что отдаёт OURA v2; недоступные эндпоинты игнорируем.
    // Пагинация по next_token — иначе OURA обрежет выдачу ~250 строками (важно для глубокой истории).
    const ep = async (path: string): Promise<{ data: OuraDoc[]; status: number }> => {
      const out: OuraDoc[] = [];
      let next: string | null = null;
      let status = 0;
      for (let page = 0; page < 40; page++) {
        const u = `https://api.ouraring.com/v2/usercollection/${path}?${range}${next ? `&next_token=${next}` : ''}`;
        const r = await fetch(u, { headers }).catch(() => null);
        if (!r) {
          status = -1;
          break;
        }
        status = r.status;
        if (!r.ok) break;
        const j: { data?: OuraDoc[]; next_token?: string | null } = await r
          .json()
          .catch(() => ({ data: [], next_token: null }));
        if (Array.isArray(j.data)) out.push(...j.data);
        next = j.next_token ?? null;
        if (!next) break;
      }
      return { data: out, status };
    };

    const [
      readiness,
      sleepScore,
      sleepDetail,
      activity,
      spo2,
      stress,
      resilience,
      cardio,
      vo2,
    ] = await Promise.all([
      ep('daily_readiness'),
      ep('daily_sleep'),
      ep('sleep'), // детальный период: HRV, RHR, стадии, дыхание, bedtime
      ep('daily_activity'),
      ep('daily_spo2'),
      ep('daily_stress'),
      ep('daily_resilience'),
      ep('daily_cardiovascular_age'),
      ep('vO2_max'),
    ]);

    const mR = byDay(readiness.data ?? []);
    const mS = byDay(sleepScore.data ?? []);
    const mD = byDay(sleepDetail.data ?? [], (d: { type?: string }) => d.type === 'long_sleep');
    const mA = byDay(activity.data ?? []);
    const mSp = byDay(spo2.data ?? []);
    const mSt = byDay(stress.data ?? []);
    const mRe = byDay(resilience.data ?? []);
    const mCa = byDay(cardio.data ?? []);
    const mVo = byDay(vo2.data ?? []);

    const allDays = new Set<string>([
      ...mR.keys(), ...mS.keys(), ...mD.keys(), ...mA.keys(),
      ...mSp.keys(), ...mSt.keys(), ...mRe.keys(), ...mCa.keys(), ...mVo.keys(),
    ]);
    if (allDays.size === 0) return json({ days: 0, note: 'no_oura_data' });

    const rows: Row[] = [];
    for (const day of allDays) {
      const r = mR.get(day) as any;
      const s = mS.get(day) as any;
      const d = mD.get(day) as any;
      const a = mA.get(day) as any;
      const sp = mSp.get(day) as any;
      const st = mSt.get(day) as any;
      const re = mRe.get(day) as any;
      const ca = mCa.get(day) as any;
      const vo = mVo.get(day) as any;

      rows.push({
        user_id: userId,
        date: day,
        // recovery / readiness
        readiness: num(r?.score),
        temp: num(r?.temperature_deviation),
        temp_trend: num(r?.temperature_trend_deviation),
        readiness_contributors: r?.contributors ?? null,
        // sleep
        sleep_score: num(s?.score),
        sleep_contributors: s?.contributors ?? null,
        hrv: num(d?.average_hrv),
        rhr: num(d?.lowest_heart_rate),
        avg_hr: num(d?.average_heart_rate),
        respiratory_rate: num(d?.average_breath),
        sleep_total_min: min(d?.total_sleep_duration),
        time_in_bed_min: min(d?.time_in_bed),
        sleep_efficiency: num(d?.efficiency),
        sleep_latency_min: min(d?.latency),
        sleep_deep_min: min(d?.deep_sleep_duration),
        sleep_rem_min: min(d?.rem_sleep_duration),
        sleep_light_min: min(d?.light_sleep_duration),
        restless_periods: num(d?.restless_periods),
        bedtime_start: d?.bedtime_start ?? null,
        bedtime_end: d?.bedtime_end ?? null,
        // activity
        activity_score: num(a?.score),
        steps: num(a?.steps),
        active_calories: num(a?.active_calories),
        total_calories: num(a?.total_calories),
        walking_distance_m: num(a?.equivalent_walking_distance),
        met_minutes: num(a?.average_met_minutes),
        active_high_min: min(a?.high_activity_time),
        active_medium_min: min(a?.medium_activity_time),
        active_low_min: min(a?.low_activity_time),
        sedentary_min: min(a?.sedentary_time),
        resting_min: min(a?.resting_time),
        activity_contributors: a?.contributors ?? null,
        // spo2 / stress / долгосрочные
        spo2_avg: num(sp?.spo2_percentage?.average),
        breathing_disturbance_idx: num(sp?.breathing_disturbance_index),
        stress_high_min: min(st?.stress_high),
        recovery_high_min: min(st?.recovery_high),
        stress_summary: st?.day_summary ?? null,
        resilience_level: re?.level ?? null,
        resilience_contributors: re?.contributors ?? null,
        vascular_age: num(ca?.vascular_age),
        vo2_max: num(vo?.vo2_max),
        // полный сырой ответ — ничего не теряем
        raw: { readiness: r, sleep: s, sleepDetail: d, activity: a, spo2: sp, stress: st, resilience: re, cardio: ca, vo2: vo },
      });
    }

    const { error: upErr } = await admin
      .from('health_snapshots')
      .upsert(rows, { onConflict: 'user_id,date' });
    if (upErr) return json({ error: upErr.message }, 500);

    const maxKey = (m: Map<string, unknown>) => [...m.keys()].sort().slice(-1)[0] ?? null;
    const d = (res: { status: number }, m: Map<string, unknown>) => ({
      status: res.status,
      count: m.size,
      latest: maxKey(m),
    });
    return json({
      days: rows.length,
      from: ymd(start),
      to: ymd(endParam),
      diag: {
        readiness: d(readiness, mR),
        sleep: d(sleepScore, mS),
        sleepDetail: d(sleepDetail, mD),
        activity: d(activity, mA),
        spo2: d(spo2, mSp),
        stress: d(stress, mSt),
        resilience: d(resilience, mRe),
        cardio: d(cardio, mCa),
        vo2: d(vo2, mVo),
      },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
