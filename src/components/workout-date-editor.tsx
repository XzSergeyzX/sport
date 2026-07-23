import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import i18n from '@/lib/i18n';

type PickerMode = 'date' | 'time';

function mergePickerValue(current: Date, selected: Date, mode: PickerMode): Date {
  const next = new Date(current);
  if (mode === 'date') {
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  } else {
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }
  return next;
}

export function WorkoutDateEditor({
  visible,
  startedAt,
  endedAt,
  onCancel,
  onSave,
}: {
  visible: boolean;
  startedAt: string;
  endedAt: string;
  onCancel: () => void;
  onSave: (startedAt: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isIos = process.env.EXPO_OS === 'ios';
  const locale = i18n.language === 'uk' ? 'uk-UA' : 'en-US';
  const [draft, setDraft] = useState(() => new Date(startedAt));
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(new Date(startedAt));
    setPickerMode(null);
    setError(null);
  }, [startedAt, visible]);

  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const dateLabel = draft.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const timeLabel = draft.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const submit = () => {
    const now = Date.now();
    const shiftedEnd = draft.getTime() + Math.max(0, durationMs);
    if (draft.getTime() > now || shiftedEnd > now) {
      setError(t('home.workoutDateFuture'));
      return;
    }
    onSave(draft.toISOString());
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = pickerMode;
    setPickerMode(null);
    if (event.type !== 'set' || !selected || !mode) return;
    setDraft((current) => mergePickerValue(current, selected, mode));
    setError(null);
  };

  const onInlinePickerChange =
    (mode: PickerMode) => (event: DateTimePickerEvent, selected?: Date) => {
      if (event.type !== 'set' || !selected) return;
      setDraft((current) => mergePickerValue(current, selected, mode));
      setError(null);
    };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
        onPress={onCancel}
      >
        <Pressable
          className="rounded-t-3xl bg-graphite-900 px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 20 }}
          onPress={() => {}}
        >
          <Text className="text-xl font-bold text-graphite-50">{t('home.workoutDateTitle')}</Text>
          <Text className="mt-2 text-sm leading-5 text-graphite-400">
            {t('home.workoutDateHint')}
          </Text>

          {isIos ? (
            <View className="mt-5 gap-2">
              <View className="min-h-14 flex-row items-center justify-between rounded-xl bg-graphite-800 px-4">
                <Text className="text-sm font-semibold text-graphite-200">{t('home.workoutDate')}</Text>
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display="compact"
                  maximumDate={new Date()}
                  themeVariant="dark"
                  onChange={onInlinePickerChange('date')}
                />
              </View>
              <View className="min-h-14 flex-row items-center justify-between rounded-xl bg-graphite-800 px-4">
                <Text className="text-sm font-semibold text-graphite-200">{t('home.workoutTime')}</Text>
                <DateTimePicker
                  value={draft}
                  mode="time"
                  display="compact"
                  themeVariant="dark"
                  onChange={onInlinePickerChange('time')}
                />
              </View>
            </View>
          ) : (
            <View className="mt-5 flex-row gap-3">
              <Pressable
                onPress={() => setPickerMode('date')}
                className="flex-1 rounded-xl bg-graphite-800 px-4 py-3 active:opacity-70"
              >
                <Text className="text-xs font-semibold uppercase tracking-wide text-graphite-500">
                  {t('home.workoutDate')}
                </Text>
                <Text className="mt-1 text-base font-semibold text-graphite-100">{dateLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => setPickerMode('time')}
                className="rounded-xl bg-graphite-800 px-4 py-3 active:opacity-70"
              >
                <Text className="text-xs font-semibold uppercase tracking-wide text-graphite-500">
                  {t('home.workoutTime')}
                </Text>
                <Text
                  className="mt-1 text-base font-semibold text-graphite-100"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {timeLabel}
                </Text>
              </Pressable>
            </View>
          )}

          {error && <Text selectable className="mt-3 text-sm text-red-400">{error}</Text>}

          <View className="mt-5 flex-row gap-3">
            <Pressable
              onPress={onCancel}
              className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
            >
              <Text className="text-sm font-semibold text-graphite-200">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              className="flex-1 items-center rounded-xl bg-accent py-3 active:opacity-80"
            >
              <Text className="text-sm font-bold text-graphite-950">{t('home.workoutDateSave')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      {!isIos && pickerMode && (
        <DateTimePicker
          value={draft}
          mode={pickerMode}
          maximumDate={new Date()}
          onChange={onPickerChange}
        />
      )}
    </Modal>
  );
}
