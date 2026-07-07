import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Единственный источник правды о высоте таб-бара. Бар позиционирован absolute
// (блюр-фон, контент просвечивает), поэтому каждый таб-экран отступает снизу
// на useTabBarHeight() — иначе низ ленты прячется под баром.
// Меняешь высоту бара — меняй только здесь ((tabs)/_layout.tsx берёт отсюда же).
export const TAB_BAR_BASE_HEIGHT = 58;

/** Полная высота бара (базовая + нижний системный инсет). */
export function useTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_BASE_HEIGHT + insets.bottom;
}
