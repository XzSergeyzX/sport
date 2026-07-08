import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/lib/use-keyboard-visible';

/**
 * Нижний лист. Бэкдроп — отдельный слой ПОД листом (а не обёртка над скроллом),
 * поэтому ScrollView внутри скроллится без перехвата жестов (раньше лагало).
 * Без KeyboardAvoidingView: его анимированный паддинг на Android мог остаться после
 * закрытия клавиатуры (стейл-геп, как было на коуче) — лист прижат к клавиатуре
 * вручную (paddingBottom = высота клавы), maxHeight считаем от видимой части экрана.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // хук гейтим по visible: закрытый (но смонтированный) лист не подписывается на клавиатуру
  const keyboardHeight = useKeyboardHeight(visible);
  const { height: windowHeight } = useWindowDimensions();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* лист поднимается над клавиатурой (edge-to-edge SDK 54 не ресайзит окно сам) */}
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: keyboardHeight }}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
          onPress={onClose}
        />
        <View
          className="rounded-t-3xl bg-graphite-900 px-6 pt-5"
          style={{ maxHeight: (windowHeight - keyboardHeight) * 0.88 }}
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
