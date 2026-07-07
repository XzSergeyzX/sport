import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { SettingsButton } from '@/components/settings-button';
import { useAuth } from '@/lib/auth/auth-context';
import { useTabBarHeight } from '@/lib/tab-bar';
import { useKeyboardHeight } from '@/lib/use-keyboard-visible';
import {
  type CoachMessage,
  type CoachThread,
  listCoachMessages,
  listCoachThreads,
  sendCoachMessage,
  transcribeAudio,
} from '@/lib/db/coach';

const PLACEHOLDER = '#848D9A';
// лимит длительности голосовой реплики. 20с сейчас; позже легко поднять (напр. 60с для премиум).
const MAX_RECORDING_SEC = 20;

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** «Сьогодні»/«Вчора»/дата — для разделителей ленты и дат в списке разговоров. */
function dayLabel(iso: string, t: (k: string) => string, lang: string): string {
  const d = new Date(iso);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return t('coach.today');
  if (diffDays === 1) return t('coach.yesterday');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function DateSeparator({ label }: { label: string }) {
  return (
    <View className="my-2 items-center">
      <Text className="rounded-full bg-graphite-900 px-3 py-1 text-[11px] font-medium text-graphite-500">
        {label}
      </Text>
    </View>
  );
}

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
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const tabBarHeight = useTabBarHeight();
  const keyboardHeight = useKeyboardHeight();

  // выбранный разговор. undefined = «ещё не выбирали» → показываем самый свежий тред;
  // null = «Нова розмова» (пустой экран, первое сообщение заведёт тред на сервере);
  // string = конкретный тред.
  const [selectedThreadId, setSelectedThreadId] = useState<string | null | undefined>(undefined);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);

  const { data: threads, isLoading: threadsLoading } = useQuery({
    queryKey: ['coach-threads', userId],
    queryFn: () => listCoachThreads(userId!),
    enabled: !!userId,
  });
  const threadList: CoachThread[] = threads ?? [];
  // эффективный тред: до первого выбора идём по самому свежему
  const activeThreadId =
    selectedThreadId === undefined ? (threadList[0]?.id ?? null) : selectedThreadId;

  // голосовой ввод (STT): запись → расшифровка падает в инпут, юзер правит и шлёт сам.
  // На web прячем (эта итерация — нативка; запись на web ведёт себя иначе).
  const voiceEnabled = Platform.OS !== 'web';
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false); // для cleanup при потере фокуса (без стейл-стейта)
  const pulse = useRef(new Animated.Value(1)).current;

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['coach-messages', activeThreadId],
    queryFn: () => listCoachMessages(activeThreadId),
    // ждём, пока треды подгрузятся и определят дефолтный (иначе мелькнёт пустой экран)
    enabled: !!userId && !threadsLoading,
  });
  const isLoading = threadsLoading || messagesLoading;

  const sendMut = useMutation({
    mutationFn: (text: string) => sendCoachMessage(text, activeThreadId),
    // новый разговор: сервер завёл тред → фиксируем его как активный, чтобы ответ и
    // дальнейшие сообщения легли в него же
    onSuccess: (res, text) => {
      if (res.threadId && res.threadId !== activeThreadId) {
        // засеваем кэш нового треда репликой+ответом, ИНАЧЕ смена ключа запроса на свежий
        // тред показала бы полноэкранный спиннер поверх чата (пустой ключ → isLoading).
        // Фоновая инвалидация ниже сверит с сервером и подставит реальные id.
        const now = new Date().toISOString();
        qc.setQueryData<CoachMessage[]>(['coach-messages', res.threadId], [
          { id: `local-u-${now}`, role: 'user', content: text, created_at: now },
          { id: `local-a-${now}`, role: 'assistant', content: res.reply, created_at: now },
        ]);
        setSelectedThreadId(res.threadId);
      }
    },
    // обновляем список в ЛЮБОМ исходе: сообщение пользователя сохраняется сервером ещё до
    // ответа модели, поэтому даже при ошибке оно должно остаться на экране (а не «откатить на старт»)
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['coach-messages'] });
      qc.invalidateQueries({ queryKey: ['coach-threads', userId] });
      setPending(null);
    },
  });

  const newConversation = () => {
    setThreadSheetOpen(false);
    setSelectedThreadId(null);
    setDraft('');
    setPending(null);
  };

  const pickThread = (id: string) => {
    setThreadSheetOpen(false);
    setSelectedThreadId(id);
    setPending(null);
  };

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

  const startRecording = async () => {
    if (recordingRef.current || transcribing || sendMut.isPending) return;
    setVoiceError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setVoiceError(t('coach.micPermission'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setVoiceError(t('coach.micError'));
    }
  };

  const stopAndTranscribe = async () => {
    if (!recordingRef.current) return;
    clearTick();
    recordingRef.current = false;
    setRecording(false);
    setTranscribing(true);
    setElapsed(0);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) throw new Error('no_audio');
      const base64 = await new File(uri).base64();
      const text = (await transcribeAudio(base64, 'audio/m4a')).trim();
      if (text) setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text));
      else setVoiceError(t('coach.micEmpty'));
    } catch {
      setVoiceError(t('coach.micError'));
    } finally {
      // временный аудио-файл не держим — расшифровали и выкинули
      if (uri) {
        try {
          new File(uri).delete();
        } catch {
          /* файл мог не создаться — не критично */
        }
      }
      setTranscribing(false);
    }
  };

  // отмена записи: глушим, файл выкидываем, на транскрипцию НЕ шлём (без костов).
  // Используется и кнопкой ✕, и при потере фокуса экрана.
  const discardRecording = useCallback(async () => {
    clearTick();
    recordingRef.current = false;
    setRecording(false);
    setElapsed(0);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      /* мог быть не запущен */
    }
    if (uri) {
      try {
        new File(uri).delete();
      } catch {
        /* не критично */
      }
    }
  }, [recorder]);

  const micPress = () => {
    if (transcribing || sendMut.isPending) return;
    if (recording) stopAndTranscribe();
    else startRecording();
  };

  // авто-стоп по лимиту длительности → сразу на расшифровку.
  // stopAndTranscribe намеренно не в deps: триггерим только по тику elapsed, а не по ре-рендеру.
  useEffect(() => {
    if (recording && elapsed >= MAX_RECORDING_SEC) stopAndTranscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, elapsed]);

  // пульсация красной точки во время записи
  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  // ушли с вкладки во время записи → глушим без транскрипции
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (recordingRef.current) discardRecording();
      };
    }, [discardRecording]),
  );

  const suggestions = [t('coach.suggest1'), t('coach.suggest2'), t('coach.suggest3')];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-graphite-950">
      <View className="flex-row items-start justify-between border-b border-graphite-800 px-6 pb-3 pt-4">
        <View className="flex-1 pr-3">
          <Text className="text-2xl font-extrabold text-graphite-50">{t('coach.title')}</Text>
          <Text className="mt-0.5 text-xs text-graphite-500">{t('coach.subtitle')}</Text>
        </View>
        {/* шестерёнка — голая 22px-иконка (общий SettingsButton), поэтому её тоже сажаем в
            такой же 36px-бокс: центры и промежутки всех трёх иконок совпадают. Отрицательный
            маргин возвращает глиф шестерёнки на общий правый край экранов (px-6). */}
        <View className="-mr-2 flex-row items-center">
          <Pressable
            onPress={newConversation}
            hitSlop={8}
            accessibilityLabel={t('coach.newChat')}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          >
            <Feather name="edit" size={20} color="#848D9A" />
          </Pressable>
          <Pressable
            onPress={() => setThreadSheetOpen(true)}
            hitSlop={8}
            accessibilityLabel={t('coach.history')}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          >
            <Feather name="clock" size={20} color="#848D9A" />
          </Pressable>
          <View className="h-9 w-9 items-center justify-center">
            <SettingsButton />
          </View>
        </View>
      </View>

      {/* Без KeyboardAvoidingView: его анимированный паддинг на Android оставался после
          закрытия клавиатуры — постоянный геп между инпутом и таббаром. Вместо этого низ
          прижимаем вручную: paddingBottom инпут-бара = высота клавиатуры (см. ниже). */}
      <View className="flex-1">
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
            {all.flatMap((m, i) => {
              const prev = i > 0 ? all[i - 1] : null;
              const newDay = !prev || m.created_at.slice(0, 10) !== prev.created_at.slice(0, 10);
              const bubble = <Bubble key={m.id} role={m.role} content={m.content} />;
              return newDay
                ? [<DateSeparator key={`sep-${m.id}`} label={dayLabel(m.created_at, t, lang)} />, bubble]
                : [bubble];
            })}
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

        {voiceError && !recording && !transcribing && (
          <View className="px-4 pt-2">
            <Text className="text-center text-xs text-red-400">{voiceError}</Text>
          </View>
        )}

        {/* инпут сидит над absolute-таббаром; при открытой клаве бар прячется
            (tabBarHideOnKeyboard), а отступ = высота клавиатуры (окно при edge-to-edge
            не ресайзится) — закрылась клава, отступ детерминированно вернулся к таббару */}
        <View
          className="border-t border-graphite-800 px-3 pt-3"
          style={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 12 : tabBarHeight + 12 }}
        >
          <View className="flex-row items-end gap-1 rounded-3xl bg-graphite-900 px-2 py-1.5">
            {recording ? (
              // режим записи: ✕ отмена · пульс + таймер · ↑ подтвердить (→ расшифровка)
              <>
                <Pressable
                  onPress={discardRecording}
                  className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
                >
                  <Feather name="x" size={20} color="#848D9A" />
                </Pressable>
                <View className="flex-1 flex-row items-center gap-2 px-1 py-2.5">
                  <Animated.View
                    style={{ opacity: pulse, backgroundColor: '#E5484D' }}
                    className="h-2.5 w-2.5 rounded-full"
                  />
                  <Text className="text-[15px] text-graphite-100">
                    {fmtElapsed(elapsed)} · {t('coach.recording')}
                  </Text>
                </View>
                <Pressable
                  onPress={stopAndTranscribe}
                  className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
                  style={{ backgroundColor: '#1FB89A' }}
                >
                  <Feather name="arrow-up" size={20} color="#0B0F14" />
                </Pressable>
              </>
            ) : transcribing ? (
              // режим расшифровки: спиннер + статус
              <View className="flex-1 flex-row items-center gap-2 px-3 py-2.5">
                <ActivityIndicator color="#848D9A" size="small" />
                <Text className="text-[15px] text-graphite-400">{t('coach.transcribing')}</Text>
              </View>
            ) : (
              // обычный режим: 🎙 микрофон · поле ввода · ↑ отправить (всё внутри бара)
              <>
                {voiceEnabled && (
                  <Pressable
                    onPress={micPress}
                    disabled={sendMut.isPending}
                    className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
                  >
                    <Feather name="mic" size={20} color="#848D9A" />
                  </Pressable>
                )}
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t('coach.placeholder')}
                  placeholderTextColor={PLACEHOLDER}
                  multiline
                  className="max-h-28 flex-1 px-2 py-2.5 text-[15px] text-graphite-50"
                />
                <Pressable
                  onPress={send}
                  disabled={!draft.trim() || sendMut.isPending}
                  className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
                  style={{ backgroundColor: draft.trim() && !sendMut.isPending ? '#1FB89A' : '#23272F' }}
                >
                  <Feather
                    name="arrow-up"
                    size={20}
                    color={draft.trim() && !sendMut.isPending ? '#0B0F14' : '#5C6675'}
                  />
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>

      <BottomSheet visible={threadSheetOpen} onClose={() => setThreadSheetOpen(false)}>
        <Text className="mb-4 text-lg font-bold text-graphite-50">{t('coach.history')}</Text>
        <Pressable
          onPress={newConversation}
          className="mb-2 flex-row items-center gap-2 rounded-xl border border-graphite-700 px-4 py-3 active:opacity-70"
        >
          <Feather name="edit" size={16} color="#1FB89A" />
          <Text className="text-sm font-semibold text-accent">{t('coach.newChat')}</Text>
        </Pressable>
        {threadList.length === 0 ? (
          <Text className="py-4 text-center text-sm text-graphite-500">{t('coach.noThreads')}</Text>
        ) : (
          threadList.map((th) => {
            const active = th.id === activeThreadId;
            return (
              <Pressable
                key={th.id}
                onPress={() => pickThread(th.id)}
                className={`mb-1 flex-row items-center justify-between gap-3 rounded-xl px-4 py-3 active:opacity-70 ${
                  active ? 'bg-graphite-800' : ''
                }`}
              >
                <Text
                  numberOfLines={1}
                  className={`flex-1 text-[15px] ${active ? 'font-semibold text-graphite-50' : 'text-graphite-200'}`}
                >
                  {th.title?.trim() || t('coach.newChat')}
                </Text>
                <Text className="text-xs text-graphite-500">{dayLabel(th.updated_at, t, lang)}</Text>
              </Pressable>
            );
          })
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}
