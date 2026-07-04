import { Adapter, AiError, CompleteInput, CompleteOutput } from './types.ts';

// OpenAI Chat Completions. Ключ: OPENAI_API_KEY (секрет функции).

const TIMEOUT_MS = 120_000;

export const openaiAdapter: Adapter = {
  available() {
    return !!Deno.env.get('OPENAI_API_KEY');
  },

  async complete(model: string, input: CompleteInput): Promise<CompleteOutput> {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new AiError('provider_unavailable', 'OPENAI_API_KEY not set');
    // tool-calling реализован только в anthropic-адаптере; честный отказ вместо тихой
    // деградации (иначе смена роута coach_chat молча оставит коуча без данных атлета)
    if (input.tools?.length) throw new AiError('tools_unsupported', 'openai adapter has no tool-calling');

    const messages = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      ...input.messages,
    ];

    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: input.maxTokens ?? 4096,
          ...(input.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        throw new AiError('provider_timeout', `openai: no response in ${TIMEOUT_MS / 1000}s`);
      }
      throw e;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new AiError('provider_error', `openai ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  },
};
