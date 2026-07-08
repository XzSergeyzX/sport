import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SettingsButton } from '@/components/settings-button';
import { useAuth } from '@/lib/auth/auth-context';
import i18n from '@/lib/i18n';
import { useTabBarHeight } from '@/lib/tab-bar';
import {
  createProgram,
  deleteProgram,
  importProgram,
  listPrograms,
  MAX_USER_PROGRAMS,
} from '@/lib/db/programs';

const PLACEHOLDER = '#848D9A';

const ERROR_KEYS: Record<string, string> = {
  budget_exceeded: 'programs.errBudget',
  provider_unavailable: 'programs.errProvider',
  parse_failed: 'programs.errParse',
  no_exercises: 'programs.errParse',
  empty_input: 'programs.errEmpty',
};

export default function ProgramsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const tabBarHeight = useTabBarHeight();

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteProgram(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs', userId] }),
  });

  const { data: programs, isLoading } = useQuery({
    queryKey: ['programs', userId],
    queryFn: () => listPrograms(userId as string),
    enabled: !!userId,
  });

  const importMut = useMutation({
    mutationFn: () => importProgram(text.trim()),
    // платный НЕидемпотентный вызов ИИ: повтор дважды списал бы кост. retry фиксируем в 0 явно
    // (дефолт и так 0 — ретраи есть только у durableRetry в workout-mutations.ts) как страховку,
    // если ретраи мутаций снова станут глобальными.
    retry: 0,
    onSuccess: (res) => {
      setText('');
      setOpen(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['programs', userId] });
      router.push(`/program/${res.program_id}`);
    },
    onError: (e: Error) => {
      const key = ERROR_KEYS[e.message];
      // для неизвестных кодов показываем сам код — чтобы видеть реальную причину
      setError(key ? t(key) : `${t('programs.errGeneric')} (${e.message})`);
    },
  });

  // ручной конструктор: создаём пустую программу и сразу открываем её в edit-режиме на добавление
  const createMut = useMutation({
    mutationFn: () => createProgram(userId as string, t('programs.newProgramTitle')),
    onSuccess: (id) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['programs', userId] });
      router.push({ pathname: '/program/[id]', params: { id, edit: '1' } });
    },
    onError: (e: Error) => {
      setError(
        e.message === 'program_cap'
          ? t('programs.errCap', { max: MAX_USER_PROGRAMS })
          : `${t('programs.errGeneric')} (${e.message})`,
      );
    },
  });

  const atCap = (programs?.length ?? 0) >= MAX_USER_PROGRAMS;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <ScrollView
        className="flex-1 px-6 pt-4"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarHeight + 24 }}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-extrabold text-graphite-50">{t('programs.title')}</Text>
          <SettingsButton />
        </View>

        {!open ? (
          <View className="mt-5 gap-3">
            <View className="flex-row gap-3">
              <Pressable
                disabled={atCap || createMut.isPending}
                onPress={() => createMut.mutate()}
                className="flex-1 items-center rounded-2xl bg-accent py-4 active:opacity-80"
                style={{ opacity: atCap ? 0.5 : 1 }}
              >
                {createMut.isPending ? (
                  <ActivityIndicator color="#0C0E12" />
                ) : (
                  <Text className="text-base font-bold text-graphite-950">{t('programs.createCta')}</Text>
                )}
              </Pressable>
              <Pressable
                disabled={atCap}
                onPress={() => {
                  setError(null);
                  setOpen(true);
                }}
                className="flex-1 items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
                style={{ opacity: atCap ? 0.5 : 1 }}
              >
                <Text className="text-base font-bold text-graphite-200">{t('programs.importCta')}</Text>
              </Pressable>
            </View>
            {atCap && (
              <Text className="text-xs text-graphite-500">
                {t('programs.capHint', { max: MAX_USER_PROGRAMS })}
              </Text>
            )}
            {error && <Text className="text-sm text-red-400">{error}</Text>}
          </View>
        ) : (
          <View className="mt-5 rounded-2xl bg-graphite-900 p-5">
            <Text className="text-base font-semibold text-graphite-100">{t('programs.importTitle')}</Text>
            <Text className="mt-2 text-sm leading-5 text-graphite-400">{t('programs.importHint')}</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('programs.importPlaceholder')}
              placeholderTextColor={PLACEHOLDER}
              multiline
              textAlignVertical="top"
              className="mt-3 min-h-[140px] rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            {error && <Text className="mt-2 text-sm text-red-400">{error}</Text>}
            <View className="mt-3 flex-row gap-3">
              <Pressable
                onPress={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="flex-1 items-center rounded-xl border border-graphite-700 py-3 active:opacity-70"
              >
                <Text className="text-sm font-semibold text-graphite-200">{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={importMut.isPending || text.trim().length < 3}
                onPress={() => importMut.mutate()}
                className="flex-1 items-center rounded-xl bg-accent py-3 active:opacity-80"
                style={{ opacity: text.trim().length < 3 ? 0.5 : 1 }}
              >
                {importMut.isPending ? (
                  <ActivityIndicator color="#0C0E12" />
                ) : (
                  <Text className="text-sm font-bold text-graphite-950">{t('programs.importGo')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        <Text className="mt-7 text-xs font-semibold uppercase tracking-wide text-graphite-500">
          {t('programs.yours')}
        </Text>
        {isLoading && !programs ? (
          <View className="mt-3 gap-3">
            {[0, 1, 2].map((i) => (
              <View key={i} className="h-[68px] rounded-2xl bg-graphite-900 opacity-60" />
            ))}
          </View>
        ) : programs && programs.length > 0 ? (
          <View className="mt-3 gap-3 pb-8">
            {programs.map((p) => (
              <Link key={p.id} href={`/program/${p.id}`} asChild>
                <Pressable className="flex-row items-center rounded-2xl bg-graphite-900 p-4 active:opacity-80">
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-graphite-100">{p.title}</Text>
                    <Text className="mt-1 text-xs text-graphite-500">
                      {/* дд.мм.гг — единый формат дат апки (дефолтный toLocaleDateString давал US-форму 7/1/2026) */}
                      {new Date(p.created_at).toLocaleDateString(
                        i18n.language === 'uk' ? 'uk-UA' : 'en-US',
                        { day: '2-digit', month: '2-digit', year: '2-digit' },
                      )}
                      {p.source === 'ai_import' ? ' · AI' : ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => setPendingDelete(p.id)} hitSlop={10} className="pl-3">
                    <Text className="text-base text-graphite-600">🗑</Text>
                  </Pressable>
                </Pressable>
              </Link>
            ))}
          </View>
        ) : (
          <Text className="mt-3 text-sm text-graphite-500">{t('programs.empty')}</Text>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!pendingDelete}
        title={t('programs.deleteTitle')}
        message={t('programs.deleteWarn')}
        confirmLabel={t('programs.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDelete) deleteMut.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}
