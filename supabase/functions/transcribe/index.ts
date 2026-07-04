// STT (§3): голосовое сообщение коучу. Клиент пишет аудио (expo-audio) → шлёт base64 сюда →
// OpenAI transcription → текст обратно в инпут (юзер правит и сам жмёт «отправить»).
// Аудио НИГДЕ не храним: расшифровали → выкинули (правило проекта).
// Ключ OPENAI_API_KEY — только здесь (серверный секрет). TTS нет (дорого).
//
// Косты: STT под общим бюджетом/kill-switch — ai_budget_check перед вызовом, ai_record_usage после.
// gpt-4o-mini-transcribe ≈ $0.003/мин аудио; на 2 юзера это копейки, но всё равно учитываем
// (как requests=1 + оценка $ по длительности).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';
import { hasAiAccess } from '../_shared/roles.ts';

const MODEL = 'gpt-4o-mini-transcribe';
const USD_PER_MIN = 0.003; // прайс OpenAI на gpt-4o-mini-transcribe (аудио-минуты)
const MAX_BYTES = 8 * 1024 * 1024; // ~8 МБ — голосовая реплика короткая; защита от абуза/раздувания костов

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// base64 → байты (Deno: atob даёт бинарную строку)
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_authorization' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'provider_unavailable' }, 502);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const audioB64 = typeof body.audio === 'string' ? body.audio : '';
    const mime = typeof body.mime === 'string' ? body.mime : 'audio/m4a';
    if (!audioB64) return json({ error: 'empty_input' }, 400);

    const bytes = b64ToBytes(audioB64);
    if (bytes.length === 0) return json({ error: 'empty_input' }, 400);
    if (bytes.length > MAX_BYTES) return json({ error: 'audio_too_large' }, 413);

    const admin = createClient(url, serviceKey);

    // роль-гейт: STT только для full/admin (комьюнити-роль grip — без ИИ)
    if (!(await hasAiAccess(admin, userId))) return json({ error: 'feature_not_available' }, 403);

    // бюджет / kill-switch (общий для всего ИИ)
    const { data: budget, error: bErr } = await admin.rpc('ai_budget_check', { p_user: userId });
    if (bErr) return json({ error: 'budget_check_failed', detail: bErr.message }, 502);
    if (!budget?.allowed) return json({ error: 'budget_exceeded', detail: budget?.reason }, 429);

    // язык-хинт из профиля (en/uk) — точнее распознавание
    const { data: prof } = await admin
      .from('profile')
      .select('language')
      .eq('user_id', userId)
      .maybeSingle();
    const lang = prof?.language === 'uk' ? 'uk' : 'en';

    // multipart → OpenAI transcriptions
    const ext = mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'mp4' : 'm4a';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`);
    form.append('model', MODEL);
    form.append('language', lang);
    form.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!res.ok) {
      // сырое тело OpenAI наружу не отдаём (может нести org-id и пр.) — только статус
      console.error(`transcribe: openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return json({ error: 'provider_error' }, 502);
    }
    const out = await res.json();
    const text = typeof out.text === 'string' ? out.text.trim() : '';

    // Учёт расхода: STT по аудио-минутам (токенов нет), requests=1 → попадает под caps.
    // Кост считаем ТОЛЬКО по размеру файла (~128 kbps AAC ≈ 16 КБ/с). Клиентскому durationSec
    // НЕ доверяем вовсе: однажды recorder.currentTime пришёл эпохой в мс (~1.78e12) и раздул
    // месячный кост до ~$89M → упёрся month_cost_cap, заблокировав весь ИИ. Размер ограничен
    // MAX_BYTES (8 МБ) → жёсткая верхняя граница ~$0.026 за запрос, абуз/баг костов исключён.
    const billSec = bytes.length / 16000;
    const cost = (billSec / 60) * USD_PER_MIN;
    await admin.rpc('ai_record_usage', {
      p_user: userId,
      p_tokens_in: 0,
      p_tokens_out: 0,
      p_cost: cost,
      p_intent: 'transcribe',
    });

    return json({ text });
  } catch (e) {
    return json({ error: 'server_error', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
