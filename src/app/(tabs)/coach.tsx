import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth/auth-context';
import { type CoachMessage, listCoachMessages, sendCoachMessage } from '@/lib/db/coach';

const PLACEHOLDER = '#848D9A';

function Bubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const mine = role === 'user';
  return (
    <View className={`mb-3 max-w-[85%] ${mine ? 'self-end' : 'self-start'}`}>
      <View
        className={`rounded-2xl px-4 py-3 ${mine ? 'bg-accent' : 'bg-graphite-900'}`}
        style={mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }}
      >
        <Text className={`text-[15px] leading-5 ${mine ? 'text-graphite-950' : 'text-graphite-100'}`}>
          {content}
        </Text>
      </View>
    </View>
  );
}

export default function CoachScreen() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ['coach-messages', userId],
    queryFn: () => listCoachMessages(userId!),
    enabled: !!userId,
  });

  const sendMut = useMutation({
    mutationFn: (text: string) => sendCoachMessage(text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach-messages', userId] }),
    onSettled: () => setPending(null),
  });

  const all: CoachMessage[] = messages ?? [];
  const hasContent = all.length > 0 || pending != null || sendMut.isPending;

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [all.length, pending, sendMut.isPending]);

  const send = () => {
    const text = draft.trim();
    if (!text || sendMut.isPending) return;
    setPending(text);
    setDraft('');
    sendMut.mutate(text);
  };

  const suggestions = [t('coach.suggest1'), t('coach.suggest2'), t('coach.suggest3')];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="border-b border-graphite-800 px-6 pb-3 pt-4">
        <Text className="text-xl font-extrabold text-graphite-50">{t('coach.title')}</Text>
        <Text className="mt-0.5 text-xs text-graphite-500">{t('coach.subtitle')}</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#848D9A" />
          </View>
        ) : !hasContent ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          >
            <Text className="text-center text-2xl">🧠</Text>
            <Text className="mt-3 text-center text-lg font-bold text-graphite-100">
              {t('coach.empty')}
            </Text>
            <Text className="mt-1 text-center text-sm text-graphite-500">{t('coach.emptyHint')}</Text>
            <View className="mt-6 gap-2">
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setDraft(s)}
                  className="items-center rounded-xl border border-graphite-800 px-4 py-3 active:opacity-70"
                >
                  <Text className="text-sm text-graphite-300">{s}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <ScrollView
            ref={scrollRef}
            className="flex-1 px-5"
            contentContainerStyle={{ paddingVertical: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {all.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} />
            ))}
            {pending != null && <Bubble role="user" content={pending} />}
            {sendMut.isPending && (
              <View className="mb-3 max-w-[85%] self-start">
                <View className="rounded-2xl bg-graphite-900 px-4 py-3" style={{ borderBottomLeftRadius: 6 }}>
                  <Text className="text-[15px] text-graphite-500">{t('coach.thinking')}</Text>
                </View>
              </View>
            )}
            {sendMut.isError && (
              <Text className="mb-2 self-start text-xs text-red-400">{t('coach.error')}</Text>
            )}
          </ScrollView>
        )}

        <View className="flex-row items-end gap-2 border-t border-graphite-800 px-4 py-3">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={PLACEHOLDER}
            multiline
            className="max-h-28 flex-1 rounded-2xl bg-graphite-900 px-4 py-3 text-[15px] text-graphite-50"
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sendMut.isPending}
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: draft.trim() && !sendMut.isPending ? '#1FB89A' : '#23272F' }}
          >
            <Text style={{ color: draft.trim() && !sendMut.isPending ? '#0B0F14' : '#5C6675', fontSize: 18, fontWeight: '900' }}>
              ↑
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
