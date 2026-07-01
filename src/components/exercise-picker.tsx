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
  onCreate: (name: string) => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const lang = i18n.language;
  const [term, setTerm] = useState('');
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
    if (visible) setTerm('');
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
              <Pressable
                onPress={() => onCreate(term.trim())}
                disabled={creating}
                className="mb-2 flex-row items-center gap-2 rounded-xl bg-graphite-800 px-3 py-3 active:opacity-80"
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
