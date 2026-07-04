import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import { secureStorage } from './secure-storage';

// Публичные значения проекта (URL + publishable-ключ). Они и так попадают в
// клиентский бандл, безопасны на клиенте (данные защищает RLS) — поэтому зашиты
// как дефолт. Это убирает зависимость от локального .env: любой комп / свежий
// клон логинится без ручной вставки ключа.
const DEFAULT_SUPABASE_URL = 'https://sdvegejubjmmlnifvigt.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-RWMi2w3VGgM_b_NjCxMVQ_LfKmD14i';

// Старые legacy-ключи имеют формат JWT (начинаются с "eyJ") и отключены Supabase
// → дают "Legacy API key". Игнорируем такой ключ из локального .env, чтобы
// устаревший .env на другом компе не ломал логин.
function pickAnonKey(envKey: string | undefined): string {
  if (!envKey || envKey.startsWith('eyJ')) return DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return envKey;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = pickAnonKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // сессия в SecureStore (Keystore/Keychain) вместо plaintext AsyncStorage; адаптер сам
    // переносит прежнюю сессию из AsyncStorage при первом запуске (юзер не разлогинивается)
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
