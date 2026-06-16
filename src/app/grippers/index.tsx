import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { useAuth } from '@/lib/auth/auth-context';
import {
  addGripper,
  deleteGripper,
  type Gripper,
  gripperLabel,
  listMyGrippers,
  updateGripper,
} from '@/lib/db/grippers';

const PLACEHOLDER = '#848D9A';

function parseNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function EditGripper({
  userId,
  gripper,
  onClose,
}: {
  userId: string;
  gripper: Gripper | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(gripper?.name ?? '');
  const [rgc, setRgc] = useState(gripper?.rgc?.toString() ?? '');
  const [unit, setUnit] = useState<'kg' | 'lb'>(gripper?.rgc_unit ?? 'kg');

  const done = () => {
    qc.invalidateQueries({ queryKey: ['my-grippers', userId] });
    qc.invalidateQueries({ queryKey: ['gripper-catalog', userId] });
    onClose();
  };

  const input = { name, rgc: parseNum(rgc), rgc_unit: unit };
  const saveMut = useMutation({
    mutationFn: () => (gripper ? updateGripper(gripper.id, input) : addGripper(userId, input)).then(() => {}),
    onSuccess: done,
  });
  const delMut = useMutation({
    mutationFn: () => deleteGripper(gripper!.id),
    onSuccess: done,
  });

  const confirmDelete = () =>
    Alert.alert(t('grippers.deleteConfirm'), gripper?.name, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('grippers.delete'), style: 'destructive', onPress: () => delMut.mutate() },
    ]);

  return (
    <>
      <Text className="text-xl font-extrabold text-graphite-50">{t('grippers.editTitle')}</Text>

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('grippers.name')}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="CoC 2.5"
            placeholderTextColor={PLACEHOLDER}
            className="mt-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
          />

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-graphite-500">
            {t('grippers.rgc')}
          </Text>
          <View className="mt-1 flex-row gap-2">
            <TextInput
              value={rgc}
              onChangeText={setRgc}
              placeholder="56"
              placeholderTextColor={PLACEHOLDER}
              keyboardType="decimal-pad"
              className="flex-1 rounded-xl bg-graphite-800 px-4 py-3 text-base text-graphite-50"
            />
            {(['kg', 'lb'] as const).map((u) => (
              <Pressable
                key={u}
                onPress={() => setUnit(u)}
                className="items-center justify-center rounded-xl px-4 active:opacity-80"
                style={{ backgroundColor: unit === u ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
              >
                <Text style={{ color: unit === u ? '#0B0F14' : '#C7CDD6' }}>{u}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            disabled={saveMut.isPending || name.trim().length === 0}
            onPress={() => saveMut.mutate()}
            className="mt-6 items-center rounded-xl bg-accent py-3 active:opacity-80"
            style={{ opacity: name.trim().length === 0 ? 0.5 : 1 }}
          >
            {saveMut.isPending ? (
              <ActivityIndicator color="#0C0E12" />
            ) : (
              <Text className="text-sm font-bold text-graphite-950">{t('grippers.save')}</Text>
            )}
          </Pressable>
          {gripper && (
            <Pressable onPress={confirmDelete} className="mt-3 items-center py-2 active:opacity-70">
              <Text className="text-sm font-semibold text-red-400">{t('grippers.delete')}</Text>
            </Pressable>
          )}
    </>
  );
}

export default function GrippersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, initializing } = useAuth();
  const userId = session?.user.id;
  const [editing, setEditing] = useState<Gripper | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: grippers, isLoading } = useQuery({
    queryKey: ['my-grippers', userId],
    queryFn: () => listMyGrippers(userId as string),
    enabled: !!userId,
  });

  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center px-6 pt-4">
        <Pressable onPress={() => router.back()} className="pr-4 active:opacity-60">
          <Text className="text-2xl text-graphite-300">‹</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-extrabold text-graphite-50">{t('grippers.title')}</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#848D9A" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {grippers && grippers.length > 0 ? (
            grippers.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setEditing(g)}
                className="mb-2 flex-row items-center justify-between rounded-2xl bg-graphite-900 p-4 active:opacity-80"
              >
                <Text className="flex-1 text-base font-semibold text-graphite-100">{gripperLabel(g)}</Text>
                <Text className="ml-2 text-graphite-600">✎</Text>
              </Pressable>
            ))
          ) : (
            <Text className="text-center text-sm leading-5 text-graphite-500">{t('grippers.empty')}</Text>
          )}

          <Pressable
            onPress={() => setAdding(true)}
            className="mt-3 items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
          >
            <Text className="text-base font-semibold text-graphite-100">{t('grippers.add')}</Text>
          </Pressable>
        </ScrollView>
      )}

      <BottomSheet
        visible={!!editing || adding}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
      >
        {userId && (!!editing || adding) && (
          <EditGripper
            key={editing?.id ?? 'new'}
            userId={userId}
            gripper={editing}
            onClose={() => {
              setEditing(null);
              setAdding(false);
            }}
          />
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}
