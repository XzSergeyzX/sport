import { Adapter, AiError, CompleteInput, CompleteOutput } from './types.ts';

// Anthropic Messages API. Ключ: ANTHROPIC_API_KEY (секрет функции).
// Поддерживает обычный чат, строгий JSON и tool-calling (агент-цикл коуча).
export const anthropicAdapter: Adapter = {
  available() {
    return !!Deno.env.get('ANTHROPIC_API_KEY');
  },

  async complete(model: string, input: CompleteInput): Promise<CompleteOutput> {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) throw new AiError('provider_unavailable', 'ANTHROPIC_API_KEY not set');

    // Anthropic держит system отдельно; в messages только user/assistant.
    // content уже совместим (строка ИЛИ блоки text/tool_use/tool_result).
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
        ...(input.tools?.length ? { tools: input.tools } : {}),
        messages,
      }),
    });

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
      stopReason: data.stop_reason ?? undefined,
      toolUses: toolUses.length ? toolUses : undefined,
    };
  },
};
