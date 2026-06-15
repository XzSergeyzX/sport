// Тянет дневные данные OURA (readiness + sleep) и пишет снимок в health_snapshots.
// Токен читается из private.oura_tokens через security-definer RPC (только service_role).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type OuraDay = { day?: string; score?: number; temperature_deviation?: number };

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
    const { data: token, error: tokErr } = await admin.rpc('get_oura_token', { p_user: userId });
    if (tokErr) return json({ error: tokErr.message }, 500);
    if (!token) return json({ error: 'not_connected' }, 400);

    const end = new Date();
    const start = new Date(end.getTime() - 2 * 86400000);
    const range = `start_date=${ymd(start)}&end_date=${ymd(end)}`;
    const headers = { Authorization: `Bearer ${token}` };

    const [rRes, sRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${range}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${range}`, { headers }),
    ]);

    const readiness = rRes.ok ? await rRes.json() : { data: [] };
    const sleep = sRes.ok ? await sRes.json() : { data: [] };

    const rDays: OuraDay[] = readiness.data ?? [];
    const sDays: OuraDay[] = sleep.data ?? [];
    const lastR = rDays.length ? rDays[rDays.length - 1] : null;
    const lastS = sDays.length ? sDays[sDays.length - 1] : null;

    if (!lastR && !lastS) return json({ snapshot: null, note: 'no_oura_data' });

    const day = lastR?.day ?? lastS?.day ?? ymd(end);
    const snapshot = {
      user_id: userId,
      date: day,
      readiness: lastR?.score ?? null,
      sleep_score: lastS?.score ?? null,
      temp: lastR?.temperature_deviation ?? null,
      raw: { readiness: lastR, sleep: lastS },
    };

    const { error: upErr } = await admin
      .from('health_snapshots')
      .upsert(snapshot, { onConflict: 'user_id,date' });
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ snapshot });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
