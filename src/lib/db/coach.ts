import { supabase } from '@/lib/supabase';

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type CoachThread = {
  id: string;
  title: string | null;
  updated_at: string;
};

/** Разговоры коуча пользователя, свежие сверху. RLS пускает только свои треды. */
export async function listCoachThreads(userId: string): Promise<CoachThread[]> {
  const { data, error } = await supabase
    .from('ai_threads')
    .select('id, title, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CoachThread[];
}

/** История одного треда (по возрастанию времени). null-тред → пусто (ещё не начатый разговор). */
export async function listCoachMessages(threadId: string | null): Promise<CoachMessage[]> {
  if (!threadId) return [];
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, created_at')
    .eq('thread_id', threadId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoachMessage[];
}

/**
 * Отправить сообщение коучу → агент в edge-функции отвечает (с учётом данных атлета).
 * `threadId` — активный разговор; null («Нова розмова») → сервер заведёт новый тред.
 * Возвращает ответ и id треда (для нового разговора — свежесозданный).
 */
export async function sendCoachMessage(
  message: string,
  threadId: string | null,
): Promise<{ reply: string; threadId: string | null }> {
  const { data, error } = await supabase.functions.invoke('coach-chat', {
    body: { message, thread_id: threadId ?? undefined },
  });
  if (error) {
    // тело ошибки функции — в error.context (Response): достаём код
    let code = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === 'function') {
      try {
        const parsed = JSON.parse(await ctx.text());
        code = parsed.error ?? parsed.detail ?? code;
      } catch {
        /* оставляем error.message */
      }
    }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return { reply: (data?.reply as string) ?? '', threadId: (data?.thread_id as string) ?? threadId };
}

/**
 * Расшифровать голосовую реплику в текст (STT). Аудио в base64 → edge-функция `transcribe`
 * (OpenAI) → текст. Аудио на сервере не хранится. Текст падает в инпут — юзер правит и шлёт сам.
 */
export async function transcribeAudio(
  audioBase64: string,
  mime: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('transcribe', {
    body: { audio: audioBase64, mime },
  });
  if (error) {
    let code = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.text === 'function') {
      try {
        const parsed = JSON.parse(await ctx.text());
        code = parsed.error ?? parsed.detail ?? code;
      } catch {
        /* оставляем error.message */
      }
    }
    throw new Error(code);
  }
  if (data?.error) throw new Error(data.error);
  return (data?.text as string) ?? '';
}
