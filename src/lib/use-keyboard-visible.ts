import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Видна ли экранная клавиатура. Android с edge-to-edge (SDK 54) не ресайзит окно,
 * поэтому экраны сами решают, что прятать/сжимать, пока юзер печатает.
 * iOS: Will-события (анимация синхроннее), Android их не шлёт — Did-события.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setVisible(true));
    const h = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  return visible;
}
