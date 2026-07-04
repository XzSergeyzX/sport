// Remote push о вердикте модерации (EAS этап 2, BACKLOG §9): после успешного
// review_leaderboard_entry админский клиент зовёт сюда, мы шлём Expo Push владельцу
// заявки на все его устройства. Realtime-слой остаётся мгновенным каналом живой апки;
// пуш закрывает свёрнутую/убитую. Expo Push API бесплатен — бюджет $30 не трогаем.
//
// Деплой с --no-verify-jwt: авторизация руками — либо service-ключ (тестовые скрипты
// с компа), либо JWT юзера с ролью admin. Контент пуша спуфить нельзя: статус читаем
// из БД, тело запроса несёт только entryId.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// зеркало строк src/lib/i18n/locales/{en,uk}.json (leaderboard.notif*) — сервер не может
// импортировать клиентские json; меняешь там — поменяй и тут
// тикет Expo Push API: ok или error с деталями (DeviceNotRegistered и т.п.)
type PushTicket = { status?: string; details?: { error?: string } };

const TEXTS = {
  en: {
    approved: {
      title: 'Entry approved 🎉',
      body: "Your leaderboard entry was approved — you're on the board. Tap to take a look.",
    },
    rejected: {
      title: 'Entry rejected',
      body: 'The moderator rejected your video proof. Check the requirements and resubmit.',
    },
  },
  uk: {
    approved: {
      title: 'Заявку схвалено 🎉',
      body: 'Твій запит на участь у лідерборді схвалено — результат уже на борді. Тисни, щоб подивитися.',
    },
    rejected: {
      title: 'Заявку відхилено',
      body: 'Модератор відхилив відео-пруф. Перевір вимоги й подай ще раз.',
    },
  },
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing_authorization' }, 401);

    const admin = createClient(url, serviceKey);

    // service-ключу верим (смоук-скрипты); всем остальным — только с ролью admin
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (bearer !== serviceKey) {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
      const { data: roleRow } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', userData.user.id)
        .maybeSingle();
      if (roleRow?.role !== 'admin') return json({ error: 'forbidden' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const entryId = typeof body.entryId === 'string' ? body.entryId : '';
    if (!entryId) return json({ error: 'missing_entry' }, 400);

    const { data: entry, error: eErr } = await admin
      .from('leaderboard_entries')
      .select('user_id, status')
      .eq('id', entryId)
      .maybeSingle();
    if (eErr) return json({ error: 'entry_lookup_failed' }, 502);
    if (!entry || (entry.status !== 'approved' && entry.status !== 'rejected')) {
      return json({ error: 'entry_not_reviewed' }, 400);
    }
    const status = entry.status as 'approved' | 'rejected';

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', entry.user_id);
    if (!tokens?.length) return json({ sent: 0, reason: 'no_tokens' });

    const { data: prof } = await admin
      .from('profile')
      .select('language')
      .eq('user_id', entry.user_id)
      .maybeSingle();
    const lang = prof?.language === 'uk' ? 'uk' : 'en';
    const text = TEXTS[lang][status];

    // data.entryId+status — ключ дедупа с локальным слоем (см. sweep в entry-notifications)
    const messages = tokens.map((row) => ({
      to: row.token,
      title: text.title,
      body: text.body,
      data: { screen: 'leaderboard', entryId, status },
      channelId: 'leaderboard-v2',
      priority: 'high',
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const receipt: { data?: PushTicket[] } | null = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('push-entry-review: expo push failed', res.status, JSON.stringify(receipt));
      return json({ error: 'expo_push_failed' }, 502);
    }

    // мёртвые токены (переустановка апки и т.п.) выкидываем сразу
    const tickets: PushTicket[] = Array.isArray(receipt?.data) ? receipt.data : [];
    const dead = messages
      .filter((_, i) => tickets[i]?.details?.error === 'DeviceNotRegistered')
      .map((m) => m.to);
    if (dead.length) await admin.from('push_tokens').delete().in('token', dead);

    // sent — только тикеты со status ok: HTTP 200 от Expo не значит, что пуш ушёл
    // (урок: InvalidCredentials приходит именно в тикете)
    const failed = tickets.filter((tk) => tk?.status !== 'ok');
    if (failed.length) console.error('push-entry-review: ticket errors', JSON.stringify(failed));
    return json({ sent: tickets.length - failed.length, failed: failed.length });
  } catch (e) {
    console.error('push-entry-review:', e);
    return json({ error: 'internal' }, 500);
  }
});
