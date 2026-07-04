import { Adapter, AiError, CompleteInput, CompleteOutput, ContentBlock } from './types.ts';

// Anthropic Messages API. Ключ: ANTHROPIC_API_KEY (секрет функции).
// Поддерживает обычный чат, строгий JSON и tool-calling (агент-цикл коуча).
//
// Prompt caching (ephemeral, TTL 5 мин): брейкпоинты на system, последнем туле и последнем
// сообщении — в агент-цикле коуча каждый следующий вызов читает весь префикс из кэша
// (×0.1 к цене инпута вместо полной). Префиксы короче минимума кэша (1024 ток.) API
// игнорирует без ошибки. Учёт: usage возвращает cache_creation/cache_read отдельно от
// input_tokens — прокидываем наверх, гейтвей считает кост с множителями 1.25/0.1.
// ВАЖНО: input.messages не мутируем (коуч переиспользует массив между турнами цикла —
// иначе cache_control накапливался бы на старых блоках, а лимит брейкпоинтов — 4).

const TIMEOUT_MS = 120_000;
const CACHE = { cache_control: { type: 'ephemeral' } } as const;

export const anthropicAdapter: Adapter = {
  available() {
    return !!Deno.env.get('ANTHROPIC_API_KEY');
  },

  async complete(model: string, input: CompleteInput): Promise<CompleteOutput> {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) throw new AiError('provider_unavailable', 'ANTHROPIC_API_KEY not set');

    // Anthropic держит system отдельно; в messages только user/assistant.
    // content уже совместим (строка ИЛИ блоки text/tool_use/tool_result).
    const systemText = [input.system, input.json ? 'Respond with valid JSON only, no prose.' : '']
      .filter(Boolean)
      .join('\n\n');
    const system = systemText ? [{ type: 'text', text: systemText, ...CACHE }] : undefined;

    const tools = input.tools?.length
      ? input.tools.map((t, i) => (i === input.tools!.length - 1 ? { ...t, ...CACHE } : t))
      : undefined;

    const chat = input.messages.filter((m) => m.role !== 'system');
    const messages = chat.map((m, i) => {
      if (i !== chat.length - 1) return { role: m.role, content: m.content };
      // брейкпоинт на последнем блоке последнего сообщения → кэшируется вся история
      const blocks: ContentBlock[] =
        typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const content = blocks.map((b, j) => (j === blocks.length - 1 ? { ...b, ...CACHE } : b));
      return { role: m.role, content };
    });

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new AiError('provider_timeout', `anthropic: no response in ${TIMEOUT_MS / 1000}s`);
      }
      throw e;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new AiError('provider_error', `anthropic ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const blocks: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] =
      Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const toolUses = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));

    return {
      text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      tokensCacheWrite: data.usage?.cache_creation_input_tokens ?? 0,
      tokensCacheRead: data.usage?.cache_read_input_tokens ?? 0,
      stopReason: data.stop_reason ?? undefined,
      toolUses: toolUses.length ? toolUses : undefined,
    };
  },
};
