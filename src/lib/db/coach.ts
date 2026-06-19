import { supabase } from '@/lib/supabase';

export type CoachMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

/** Тред коуча пользователя (последний). null — ещё не было ни одного сообщения. */
async function getThreadId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('ai_threads')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** История чата коуча (по возрастанию времени). RLS пускает только свой тред. */
export async function listCoachMessages(userId: string): Promise<CoachMessage[]> {
  const threadId = await getThreadId(userId);
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

/** Отправить сообщение коучу → агент в edge-функции отвечает (с учётом данных атлета). */
export async function sendCoachMessage(message: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('coach-chat', {
    body: { message },
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
  return (data?.reply as string) ?? '';
}
