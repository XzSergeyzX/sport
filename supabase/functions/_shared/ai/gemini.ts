import { Adapter, AiError, CompleteInput, CompleteOutput } from './types.ts';

// Google Gemini generateContent. Ключ: GEMINI_API_KEY (секрет функции, опционально).
export const geminiAdapter: Adapter = {
  available() {
    return !!Deno.env.get('GEMINI_API_KEY');
  },

  async complete(model: string, input: CompleteInput): Promise<CompleteOutput> {
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) throw new AiError('provider_unavailable', 'GEMINI_API_KEY not set');

    const contents = input.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const systemBits = [input.system, input.json ? 'Respond with valid JSON only.' : '']
      .filter(Boolean)
      .join('\n\n');

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(systemBits ? { systemInstruction: { parts: [{ text: systemBits }] } } : {}),
        ...(input.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new AiError('provider_error', `gemini ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const text =
      data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    return {
      text,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
