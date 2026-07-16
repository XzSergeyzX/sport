import { useCallback, useEffect, useRef } from 'react';

/**
 * Объединяет частые вызовы, но позволяет синхронно поставить последний в очередь перед
 * навигацией/blur. На unmount pending-вызов тоже исполняется — введённое не теряется.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
) {
  const callbackRef = useRef(callback);
  const argsRef = useRef<Args | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  callbackRef.current = callback;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (argsRef.current === null) return;
    const args = argsRef.current;
    argsRef.current = null;
    clearTimer();
    callbackRef.current(...args);
  }, [clearTimer]);

  const cancel = useCallback(() => {
    argsRef.current = null;
    clearTimer();
  }, [clearTimer]);

  const schedule = useCallback(
    (...args: Args) => {
      argsRef.current = args;
      clearTimer();
      timerRef.current = setTimeout(flush, delayMs);
    },
    [clearTimer, delayMs, flush],
  );

  useEffect(() => () => flush(), [flush]);

  return { schedule, flush, cancel };
}

export function flushPendingCallbacks(callbacks: Iterable<() => void>): void {
  for (const flush of callbacks) flush();
}
