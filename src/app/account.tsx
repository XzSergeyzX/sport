import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Segmented } from '@/components/segmented';
import { useAuth } from '@/lib/auth/auth-context';
import { AVATARS } from '@/lib/avatars';
import { getTrackCycle, setTrackCycle } from '@/lib/db/cycle';
import { getAvatar, type Gender, getGender, setAvatar, setGender } from '@/lib/db/profile';
import i18n, { type AppLanguage } from '@/lib/i18n';
import { applyLanguage, applyUnit } from '@/lib/prefs';
import { useWeightUnit, type WeightUnit } from '@/lib/use-unit';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// заголовок группы (iOS-style) над карточкой
function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-2 ml-1 mt-7 text-xs font-semibold uppercase tracking-wide text-graphite-500">
      {children}
    </Text>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <View className="overflow-hidden rounded-2xl bg-graphite-900">{children}</View>;
}
function Divider() {
  return <View className="ml-4 h-px bg-graphite-800" />;
}
// строка-навигация внутри карточки (иконка + подпись + шеврон)
function NavRow({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-4 active:opacity-70">
      <Ionicons name={icon} size={20} color="#848D9A" />
      <Text className="ml-3 flex-1 text-base font-medium text-graphite-100">{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#5C6675" />
    </Pressable>
  );
}
// чип выбора (тот же стиль, что и в каталоге; выбранное — accent)
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-3 py-1.5 active:opacity-80"
      style={{ backgroundColor: active ? '#1FB89A' : 'rgba(255,255,255,0.06)' }}
    >
      <Text className="text-sm" style={{ color: active ? '#0B0F14' : '#C7CDD6' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, initializing, signOut } = useAuth();
  const userId = session?.user.id;

  const { data: gender } = useQuery({
    queryKey: ['gender', userId],
    queryFn: () => getGender(userId as string),
    enabled: !!userId,
  });
  const genderMut = useMutation({
    mutationFn: (v: { g: Gender; self?: string | null }) => setGender(userId as string, v.g, v.self),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gender', userId] }),
  });
  const [genderSelf, setGenderSelf] = useState('');
  const [pendingSignOut, setPendingSignOut] = useState(false);

  const { data: trackCycle } = useQuery({
    queryKey: ['track-cycle', userId],
    queryFn: () => getTrackCycle(userId as string),
    enabled: !!userId,
  });
  const cycleMut = useMutation({
    mutationFn: (v: boolean) => setTrackCycle(userId as string, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-cycle', userId] }),
  });

  const { data: avatar } = useQuery({
    queryKey: ['avatar', userId],
    queryFn: () => getAvatar(userId as string),
    enabled: !!userId,
  });
  const avatarMut = useMutation({
    mutationFn: (key: string | null) => setAvatar(userId as string, key),
    onError: () => qc.invalidateQueries({ queryKey: ['avatar', userId] }), // откат оптимистики
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const chooseAvatar = (key: string | null) => {
    qc.setQueryData(['avatar', userId], key); // оптимистично — кружок меняется сразу
    avatarMut.mutate(key);
    setPickerOpen(false);
  };

  const GENDERS: Gender[] = ['male', 'female', 'other', 'na'];

  const [language, setLanguage] = useState<AppLanguage>(
    (i18n.language as AppLanguage) === 'uk' ? 'uk' : 'en',
  );
  const unit = useWeightUnit();

  const onChangeLanguage = (next: AppLanguage) => {
    setLanguage(next);
    void applyLanguage(next, userId);
  };
  const onChangeUnit = (next: WeightUnit) => {
    void applyUnit(next, userId);
  };
  const onSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  // self-guard: экран вне (tabs), своего гейта сессии у него нет (как в exercises/grippers)
  if (!initializing && !session) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-graphite-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} hitSlop={10} className="pr-3 active:opacity-60">
            <Text className="text-2xl text-graphite-300">‹</Text>
          </Pressable>
          <Text className="flex-1 text-2xl font-extrabold text-graphite-50">{t('account.title')}</Text>
        </View>

        {/* блок идентичности: аватар (тап → выбор) + email */}
        <View className="mt-5 flex-row items-center rounded-2xl bg-graphite-900 p-4">
          <Pressable onPress={() => setPickerOpen(true)} hitSlop={6} className="active:opacity-70">
            <Avatar email={session?.user.email} avatarKey={avatar} size={48} />
            <View className="absolute -bottom-1 -right-1 h-5 w-5 items-center justify-center rounded-full border-2 border-graphite-900 bg-accent">
              <Ionicons name="pencil" size={10} color="#0B0F14" />
            </View>
          </Pressable>
          <Text className="ml-3 flex-1 text-base font-semibold text-graphite-100" numberOfLines={1}>
            {session?.user.email ?? '—'}
          </Text>
        </View>

        {/* —— Налаштування —— */}
        <SectionCaption>{t('account.sectionPrefs')}</SectionCaption>
        <Card>
          <View className="px-4 pb-4 pt-4">
            <Text className="mb-2 text-sm text-graphite-400">{t('onboarding.languageTitle')}</Text>
            <Segmented<AppLanguage>
              value={language}
              onChange={onChangeLanguage}
              options={[
                { value: 'en', label: t('common.english') },
                { value: 'uk', label: t('common.ukrainian') },
              ]}
            />
          </View>
          <Divider />
          <View className="px-4 pb-4 pt-4">
            <Text className="mb-2 text-sm text-graphite-400">{t('onboarding.weightTitle')}</Text>
            <Segmented<WeightUnit>
              value={unit}
              onChange={onChangeUnit}
              options={[
                { value: 'kg', label: t('common.kg') },
                { value: 'lb', label: t('common.lb') },
              ]}
            />
          </View>
        </Card>

        {/* —— Профіль —— */}
        <SectionCaption>{t('account.sectionProfile')}</SectionCaption>
        <Card>
          <View className="px-4 pb-4 pt-4">
            <Text className="mb-2 text-sm text-graphite-400">{t('gender.title')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {GENDERS.map((g) => (
                <Chip
                  key={g}
                  label={t(`gender.${g}`)}
                  active={gender?.gender === g}
                  onPress={() => genderMut.mutate({ g, self: genderSelf || gender?.self })}
                />
              ))}
            </View>
            {gender?.gender === 'other' && (
              <TextInput
                value={genderSelf || (gender?.self ?? '')}
                onChangeText={setGenderSelf}
                onEndEditing={() => genderMut.mutate({ g: 'other', self: genderSelf })}
                placeholder={t('gender.custom')}
                placeholderTextColor="#848D9A"
                className="mt-2 rounded-xl bg-graphite-800 px-4 py-2.5 text-base text-graphite-50"
              />
            )}
          </View>

          {gender?.gender === 'female' && (
            <>
              <Divider />
              <View className="flex-row items-center justify-between px-4 py-4">
                <View className="flex-1 pr-4">
                  <Text className="text-base font-medium text-graphite-100">{t('account.trackCycle')}</Text>
                  <Text className="mt-0.5 text-xs text-graphite-500">{t('account.trackCycleHint')}</Text>
                </View>
                <Switch
                  value={!!trackCycle}
                  onValueChange={(v) => cycleMut.mutate(v)}
                  trackColor={{ true: '#1FB89A', false: '#3A3F49' }}
                  thumbColor="#E5E7EB"
                />
              </View>
            </>
          )}
        </Card>

        {/* —— Каталог —— */}
        <SectionCaption>{t('account.sectionCatalog')}</SectionCaption>
        <Card>
          <NavRow
            icon="barbell-outline"
            label={t('account.myExercises')}
            onPress={() => router.push('/exercises')}
          />
          <Divider />
          <NavRow
            icon="hand-left-outline"
            label={t('account.myGrippers')}
            onPress={() => router.push('/grippers')}
          />
        </Card>

        <Pressable
          onPress={() => setPendingSignOut(true)}
          className="mt-8 items-center rounded-2xl border border-red-900 py-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-red-400">{t('home.signOut')}</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={pendingSignOut}
        title={t('account.signOutConfirmTitle')}
        message={t('account.signOutConfirmMsg')}
        confirmLabel={t('home.signOut')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          setPendingSignOut(false);
          void onSignOut();
        }}
        onCancel={() => setPendingSignOut(false)}
      />

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => setPickerOpen(false)}
        >
          {/* стоп-проп: тап по самому листу не закрывает */}
          <Pressable onPress={() => {}} className="rounded-t-3xl bg-graphite-900 px-5 pb-10 pt-5">
            <Text className="text-lg font-bold text-graphite-50">{t('account.avatarTitle')}</Text>
            <View className="mt-4 flex-row flex-wrap gap-4">
              <Pressable onPress={() => chooseAvatar(null)} className="items-center active:opacity-70">
                <View
                  style={{
                    borderWidth: 2,
                    borderColor: avatar ? 'transparent' : '#1FB89A',
                    borderRadius: 999,
                    padding: 2,
                  }}
                >
                  <Avatar email={session?.user.email} avatarKey={null} size={56} />
                </View>
                <Text className="mt-1 text-xs text-graphite-500">{t('account.avatarDefault')}</Text>
              </Pressable>
              {AVATARS.map((a) => (
                <Pressable key={a.key} onPress={() => chooseAvatar(a.key)} className="active:opacity-70">
                  <View
                    style={{
                      borderWidth: 2,
                      borderColor: avatar === a.key ? '#1FB89A' : 'transparent',
                      borderRadius: 999,
                      padding: 2,
                    }}
                  >
                    <Avatar avatarKey={a.key} size={56} />
                  </View>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
