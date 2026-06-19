// Единый интерфейс для всех провайдеров ИИ. Адаптеры приводят свой API к этому.

// Блоки контента сообщения. Текст — везде; tool_use/tool_result — для агент-цикла (tool-calling).
export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string };
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
};

// Описание инструмента для модели (JSON-schema входа).
export type ToolSpec = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type CompleteInput = {
  system?: string;
  messages: ChatMessage[];
  json?: boolean; // просим строгий JSON в ответе
  tools?: ToolSpec[]; // если заданы — модель может звать инструменты
  maxTokens?: number;
};

export type CompleteOutput = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  stopReason?: string; // 'tool_use' → модель просит вызвать инструмент(ы)
  toolUses?: { id: string; name: string; input: unknown }[];
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
