import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

type Mode = 'password' | 'code';

const PLACEHOLDER = '#848D9A';

export default function AuthScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setMessage(null);
  };

  const run = async (fn: () => Promise<void>) => {
    reset();
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      router.replace('/');
    });

  const signUp = () =>
    run(async () => {
      const { data, error: err } = await supabase.auth.signUp({ email, password });
      if (err) throw err;
      if (data.session) router.replace('/');
      else setMessage(t('auth.checkEmailConfirm'));
    });

  const sendCode = () =>
    run(async () => {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (err) throw err;
      setCodeSent(true);
      setMessage(t('auth.codeSent'));
    });

  const verifyCode = () =>
    run(async () => {
      const { error: err } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (err) throw err;
      router.replace('/');
    });

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="gap-2">
          <Text className="text-3xl font-extrabold text-graphite-50">{t('auth.title')}</Text>
          <Text className="text-base text-graphite-400">{t('auth.subtitle')}</Text>
        </View>

        {/* Переключатель способа входа */}
        <View className="flex-row rounded-2xl bg-graphite-800 p-1">
          {(['password', 'code'] as Mode[]).map((m) => {
            const selected = m === mode;
            return (
              <Pressable
                key={m}
                onPress={() => {
                  setMode(m);
                  reset();
                }}
                className={`flex-1 items-center rounded-xl py-2.5 ${selected ? 'bg-graphite-100' : ''}`}
              >
                <Text
                  className={`text-sm font-semibold ${selected ? 'text-graphite-950' : 'text-graphite-300'}`}
                >
                  {m === 'password' ? t('auth.modePassword') : t('auth.modeCode')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="gap-3">
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.email')}
            placeholderTextColor={PLACEHOLDER}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            className="rounded-xl bg-graphite-800 px-4 py-3.5 text-base text-graphite-50"
          />

          {mode === 'password' && (
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.password')}
              placeholderTextColor={PLACEHOLDER}
              secureTextEntry
              autoCapitalize="none"
              className="rounded-xl bg-graphite-800 px-4 py-3.5 text-base text-graphite-50"
            />
          )}

          {mode === 'code' && codeSent && (
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder={t('auth.code')}
              placeholderTextColor={PLACEHOLDER}
              keyboardType="number-pad"
              className="rounded-xl bg-graphite-800 px-4 py-3.5 text-base tracking-widest text-graphite-50"
            />
          )}
        </View>

        {error && <Text className="text-sm text-red-400">{error}</Text>}
        {message && <Text className="text-sm text-accent">{message}</Text>}

        <View className="gap-3">
          {mode === 'password' ? (
            <>
              <Pressable
                disabled={loading}
                onPress={signIn}
                className="items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
              >
                {loading ? (
                  <ActivityIndicator color="#0C0E12" />
                ) : (
                  <Text className="text-base font-bold text-graphite-950">{t('auth.signIn')}</Text>
                )}
              </Pressable>
              <Pressable
                disabled={loading}
                onPress={signUp}
                className="items-center rounded-2xl border border-graphite-700 py-4 active:opacity-70"
              >
                <Text className="text-base font-semibold text-graphite-100">{t('auth.signUp')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              disabled={loading}
              onPress={codeSent ? verifyCode : sendCode}
              className="items-center rounded-2xl bg-graphite-50 py-4 active:opacity-80"
            >
              {loading ? (
                <ActivityIndicator color="#0C0E12" />
              ) : (
                <Text className="text-base font-bold text-graphite-950">
                  {codeSent ? t('auth.verify') : t('auth.sendCode')}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
