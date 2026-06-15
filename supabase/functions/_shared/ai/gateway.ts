// Провайдер-агностик гейтвей: интент → роут из БД → бюджет-чек → адаптер → учёт расхода.
// Импортируется любой функцией, которой нужен ИИ (program-import, coach-chat, …).
import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { anthropicAdapter } from './anthropic.ts';
import { geminiAdapter } from './gemini.ts';
import { openaiAdapter } from './openai.ts';
import { Adapter, AiError, CompleteInput, Provider } from './types.ts';

const ADAPTERS: Record<Provider, Adapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

type Route = {
  intent: string;
  provider: Provider;
  model: string;
  price_in: number;
  price_out: number;
  enabled: boolean;
};

export type RunResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  provider: Provider;
  model: string;
};

/**
 * Прогнать интент через гейтвей.
 * @param admin service_role клиент (обходит RLS, может звать защищённые RPC)
 */
export async function runIntent(
  admin: SupabaseClient,
  userId: string,
  intent: string,
  input: CompleteInput,
): Promise<RunResult> {
  // 1) бюджет / kill-switch
  const { data: budget, error: bErr } = await admin.rpc('ai_budget_check', { p_user: userId });
  if (bErr) throw new AiError('budget_check_failed', bErr.message);
  if (!budget?.allowed) throw new AiError('budget_exceeded', budget?.reason ?? 'budget');

  // 2) роут
  const { data: route, error: rErr } = await admin
    .from('ai_model_routes')
    .select('*')
    .eq('intent', intent)
    .maybeSingle<Route>();
  if (rErr) throw new AiError('route_lookup_failed', rErr.message);
  if (!route) throw new AiError('no_route', `no route for intent ${intent}`);
  if (!route.enabled) throw new AiError('route_disabled', intent);

  const adapter = ADAPTERS[route.provider];
  if (!adapter.available()) {
    throw new AiError('provider_unavailable', `${route.provider} key not set`);
  }

  // 3) вызов модели
  const out = await adapter.complete(route.model, input);

  // 4) учёт расхода (оценка стоимости по ценам роута)
  const cost =
    (out.tokensIn / 1_000_000) * route.price_in + (out.tokensOut / 1_000_000) * route.price_out;
  await admin.rpc('ai_record_usage', {
    p_user: userId,
    p_tokens_in: out.tokensIn,
    p_tokens_out: out.tokensOut,
    p_cost: cost,
  });

  return { ...out, cost, provider: route.provider, model: route.model };
}
