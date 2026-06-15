// Сохраняет OURA Personal Access Token пользователя.
// Токен валидируется запросом к OURA и кладётся в private.oura_tokens
// (через security-definer RPC). Сам токен никогда не попадает на клиент.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return json({ error: 'token_required' }, 400);

    // Валидируем токен у OURA
    const probe = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!probe.ok) return json({ error: 'invalid_oura_token' }, 400);

    const admin = createClient(url, serviceKey);
    const { error: rpcErr } = await admin.rpc('store_oura_token', {
      p_user: userId,
      p_token: token,
    });
    if (rpcErr) return json({ error: rpcErr.message }, 500);

    return json({ connected: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
