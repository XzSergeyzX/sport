import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

const PLACEHOLDER = '#848D9A';

export default function AuthScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMessage(null);
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

  return (
    <SafeAreaView className="flex-1 bg-graphite-950">
      <View className="flex-1 justify-center gap-6 px-6">
        <View className="gap-2">
          <Text className="text-3xl font-extrabold text-graphite-50">{t('auth.title')}</Text>
          <Text className="text-base text-graphite-400">{t('auth.subtitle')}</Text>
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
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.password')}
            placeholderTextColor={PLACEHOLDER}
            secureTextEntry
            autoCapitalize="none"
            className="rounded-xl bg-graphite-800 px-4 py-3.5 text-base text-graphite-50"
          />
        </View>

        {error && <Text className="text-sm text-red-400">{error}</Text>}
        {message && <Text className="text-sm text-accent">{message}</Text>}

        <View className="gap-3">
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
        </View>
      </View>
    </SafeAreaView>
  );
}
