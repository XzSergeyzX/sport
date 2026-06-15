import { Adapter, AiError, CompleteInput, CompleteOutput } from './types.ts';

// Anthropic Messages API. Ключ: ANTHROPIC_API_KEY (секрет функции).
export const anthropicAdapter: Adapter = {
  available() {
    return !!Deno.env.get('ANTHROPIC_API_KEY');
  },

  async complete(model: string, input: CompleteInput): Promise<CompleteOutput> {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) throw new AiError('provider_unavailable', 'ANTHROPIC_API_KEY not set');

    // Anthropic держит system отдельно; в messages только user/assistant.
    const system = [input.system, input.json ? 'Respond with valid JSON only, no prose.' : '']
      .filter(Boolean)
      .join('\n\n');
    const messages = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new AiError('provider_error', `anthropic ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const text = Array.isArray(data.content)
      ? data.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
      : '';
    return {
      text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  },
};
