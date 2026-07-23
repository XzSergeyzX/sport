import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  categoryKey,
  clusterKey,
  type Exercise,
  exerciseName,
  groupByCluster,
  isVisible,
  listExercises,
  matchExercise,
} from '@/lib/db/exercises';
import { getRecentExercises } from '@/lib/db/workouts';
import i18n from '@/lib/i18n';

const PLACEHOLDER = '#848D9A';

/**
 * Общий пикер упражнений: поиск по всему каталогу + просмотр видимых (база + включённые
 * дисциплины + свои) + «недавние» + создание кастома через onCreate. Переиспользуется
 * в логировании тренировки (workout/[id]) и в ручном конструкторе программы (program/[id]).
 */
export function ExercisePicker({
  visible,
  disciplines,
  onClose,
  onSelect,
  onCreate,
  creating,
}: {
  visible: boolean;
  disciplines: string[];
  onClose: () => void;
  onSelect: (ex: Exercise) => void;
  onCreate: (input: { name: string; unilateral: boolean }) => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const lang = i18n.language;
  const [term, setTerm] = useState('');
  const [customSided, setCustomSided] = useState(false);
  const searching = term.trim() !== '';
  const { data, isFetching } = useQuery({
    queryKey: ['exercises-all'],
    queryFn: listExercises,
    enabled: visible,
  });
  const { data: recent } = useQuery({
    queryKey: ['exercises-recent'],
    queryFn: () => getRecentExercises(8),
    enabled: visible,
  });

  // сбрасываем поиск при каждом открытии — заново то же упражнение почти не выбирают
  useEffect(() => {
    if (visible) {
      setTerm('');
      setCustomSided(false);
    }
  }, [visible]);

  const groups = useMemo(() => {
    const all = data ?? [];
    // поиск пробивает всё; просмотр — только база + включённые дисциплины + свои
    const filtered = searching
      ? all.filter((ex) => matchExercise(ex, term))
      : all.filter((ex) => isVisible(ex, disciplines));
    return groupByCluster(filtered);
  }, [data, term, searching, disciplines]);

  const row = (ex: (typeof groups)[number]['items'][number]) => (
    <Pressable
      key={ex.id}
      onPress={() => onSelect(ex)}
      className="flex-row items-center justify-between border-b border-graphite-800 py-3 active:opacity-70"
    >
      <Text className="flex-1 text-base text-graphite-100">{exerciseName(ex, lang)}</Text>
      <Text className="ml-3 text-xs text-graphite-500">
        {ex.is_global ? t(categoryKey(ex.category)) : t('workout.userAdded')}
      </Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <SafeAreaView
          edges={['bottom']}
          className="rounded-t-3xl bg-graphite-900 px-5 pt-4"
          style={{ maxHeight: '80%' }}
        >
          <View className="flex-row items-center gap-3">
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder={t('workout.search')}
              placeholderTextColor={PLACEHOLDER}
              returnKeyType="search"
              className="flex-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            <Pressable onPress={onClose} hitSlop={8}>
              <Text className="text-sm text-graphite-400">{t('common.cancel')}</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            className="mt-3"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {isFetching && <ActivityIndicator color="#848D9A" />}

            {searching && (
              <View className="mb-2 rounded-xl bg-graphite-800 p-3">
                <Text className="text-xs font-semibold uppercase tracking-wide text-graphite-500">
                  {t('exercises.sideTracking')}
                </Text>
                <View className="mt-2 flex-row gap-2">
                  <Pressable
                    onPress={() => setCustomSided(false)}
                    className="flex-1 items-center rounded-xl border px-2 py-2.5 active:opacity-80"
                    style={{
                      borderColor: customSided ? '#343B46' : '#1FB89A',
                      backgroundColor: customSided ? 'transparent' : 'rgba(31,184,154,0.12)',
                    }}
                  >
                    <Text
                      className="text-center text-sm"
                      style={{ color: customSided ? '#C7CDD6' : '#1FB89A' }}
                    >
                      {t('exercises.sideTrackingOff')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setCustomSided(true)}
                    className="flex-1 items-center rounded-xl border px-2 py-2.5 active:opacity-80"
                    style={{
                      borderColor: customSided ? '#1FB89A' : '#343B46',
                      backgroundColor: customSided ? 'rgba(31,184,154,0.12)' : 'transparent',
                    }}
                  >
                    <Text
                      className="text-center text-sm"
                      style={{ color: customSided ? '#1FB89A' : '#C7CDD6' }}
                    >
                      {t('exercises.sideTrackingOn')}
                    </Text>
                  </Pressable>
                </View>
                <Text className="mt-2 text-xs text-graphite-500">
                  {customSided
                    ? t('exercises.sideTrackingHintOn')
                    : t('exercises.sideTrackingHintOff')}
                </Text>
                <Pressable
                  onPress={() => onCreate({ name: term.trim(), unilateral: customSided })}
                  disabled={creating}
                  className="mt-3 flex-row items-center gap-2 rounded-xl bg-graphite-700 px-3 py-3 active:opacity-80"
                >
                  {creating ? (
                    <ActivityIndicator color="#848D9A" />
                  ) : (
                    <>
                      <Text className="text-base text-accent">＋</Text>
                      <Text className="flex-1 text-base text-graphite-100">
                        {t('workout.createCustom', { name: term.trim() })}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {!isFetching && !searching && groups.length === 0 && (
              <Text className="text-base text-graphite-400">{t('workout.noResults')}</Text>
            )}

            {!searching && recent && recent.length > 0 && (
              <View className="mb-2">
                <Text className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {t('workout.frequent')}
                </Text>
                {recent.map((ex) => row(ex))}
              </View>
            )}

            {groups.map((g) => (
              <View key={g.cluster ?? 'other'} className="mb-2">
                <Text className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-graphite-500">
                  {t(clusterKey(g.cluster))}
                </Text>
                {g.items.map((ex) => row(ex))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
