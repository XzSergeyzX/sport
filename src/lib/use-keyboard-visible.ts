import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

/**
 * Видна ли экранная клавиатура. Android с edge-to-edge (SDK 54) не ресайзит окно,
 * поэтому экраны сами решают, что прятать/сжимать, пока юзер печатает.
 * iOS: Will-события (анимация синхроннее), Android их не шлёт — Did-события.
 */
export function useKeyboardVisible(): boolean {
  return useKeyboardHeight() > 0;
}

/**
 * Высота клавиатуры в dp (0 = скрыта). Для экранов, где низ прижат к клавиатуре
 * ВРУЧНУЮ (паддингом), вместо KeyboardAvoidingView: его анимированный паддинг на
 * Android мог остаться после закрытия клавиатуры (стейл-геп на экране коуча) —
 * прямое значение из событий детерминировано, keyboardDidHide всегда обнуляет.
 * enabled=false снимает листенеры (и обнуляет высоту): смонтированный, но закрытый
 * BottomSheet не должен ре-рендериться на каждый показ клавиатуры где-то ещё.
 */
export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setHeight(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setHeight(0));
    // iOS меняет рамку БЕЗ повторного willShow (emoji-клавиатура выше буквенной,
    // QuickType-бар) — ловим willChangeFrame и меряем видимую часть от низа окна.
    // Android такого события не шлёт, но ре-файрит keyboardDidShow при ресайзе.
    const f =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillChangeFrame', (e) =>
            setHeight(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY)),
          )
        : null;
    return () => {
      s.remove();
      h.remove();
      f?.remove();
    };
  }, [enabled]);
  return height;
}
