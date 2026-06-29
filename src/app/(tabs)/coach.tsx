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
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettingsButton } from '@/components/settings-button';
import { useAuth } from '@/lib/auth/auth-context';
import {
  type CoachMessage,
  listCoachMessages,
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

  const { data: messages, isLoading } = useQuery({
    queryKey: ['coach-messages', userId],
    queryFn: () => listCoachMessages(userId!),
    enabled: !!userId,
  });

  const sendMut = useMutation({
    mutationFn: (text: string) => sendCoachMessage(text),
    // обновляем список в ЛЮБОМ исходе: сообщение пользователя сохраняется сервером ещё до
    // ответа модели, поэтому даже при ошибке оно должно остаться на экране (а не «откатить на старт»)
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['coach-messages', userId] });
      setPending(null);
    },
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
        <SettingsButton />
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        // padding и на Android: при edge-to-edge (SDK 54) окно не ресайзится под клавиатуру,
        // поэтому undefined-behavior оставлял поле ввода под клавиатурой. Таб-бар прячется
        // через tabBarHideOnKeyboard, так что лишнего отступа снизу нет.
        behavior="padding"
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

        {voiceError && !recording && !transcribing && (
          <View className="px-4 pt-2">
            <Text className="text-center text-xs text-red-400">{voiceError}</Text>
          </View>
        )}

        <View className="border-t border-graphite-800 px-3 py-3">
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
