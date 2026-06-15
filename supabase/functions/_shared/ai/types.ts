// Единый интерфейс для всех провайдеров ИИ. Адаптеры приводят свой API к этому.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type CompleteInput = {
  system?: string;
  messages: ChatMessage[];
  json?: boolean; // просим строгий JSON в ответе
  maxTokens?: number;
};

export type CompleteOutput = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};

export type Provider = 'openai' | 'anthropic' | 'gemini';

export interface Adapter {
  // true, если ключ провайдера задан в секретах (иначе провайдер «выключен»)
  available(): boolean;
  complete(model: string, input: CompleteInput): Promise<CompleteOutput>;
}

export class AiError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}
