import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/** Тематический диалог подтверждения (вместо нативного Alert — он не в стиле апки).
 *  Без cancelLabel — режим простого алерта с одной кнопкой. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
          onPress={onCancel}
        />
        <View className="w-full rounded-2xl bg-graphite-900 p-5" style={{ maxWidth: 380 }}>
          <Text className="text-lg font-bold text-graphite-50">{title}</Text>
          {message ? (
            <Text className="mt-2 text-sm leading-5 text-graphite-400">{message}</Text>
          ) : null}
          <View className="mt-5 flex-row justify-end gap-2">
            {!!cancelLabel && (
              <Pressable onPress={onCancel} className="rounded-xl px-4 py-2.5 active:opacity-70">
                <Text className="text-sm font-semibold text-graphite-300">{cancelLabel}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onConfirm}
              className="rounded-xl px-4 py-2.5 active:opacity-80"
              style={{ backgroundColor: destructive ? 'rgba(239,68,68,0.16)' : '#1FB89A' }}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: destructive ? '#F87171' : '#0B0F14' }}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
