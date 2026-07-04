// Хранилище сессии Supabase в SecureStore (Keystore/Keychain), а не в plaintext AsyncStorage
// (хвост аудита дня-46: токены доступа лежали открытым текстом в песочнице приложения).
//
// SecureStore ограничен ~2048 байт на значение, а сессия Supabase (access+refresh+user) больше —
// поэтому режем на чанки. При первом чтении переносим прежнюю сессию из AsyncStorage (чтобы
// текущие юзеры не разлогинились на апдейте) и подчищаем открытую копию.
//
// Web не цель проекта, но бандл собирается и под него (react-native-web) — там SecureStore нет,
// поэтому на web прозрачно падаем в AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK = 1800; // с запасом под лимит 2048 (JWT — ASCII, символ ≈ байт)
const isWeb = Platform.OS === 'web';
const countKey = (k: string) => `${k}__n`;

async function removeItem(key: string): Promise<void> {
  if (isWeb) return AsyncStorage.removeItem(key);
  const n = await SecureStore.getItemAsync(countKey(key));
  const count = n ? parseInt(n, 10) : 0;
  for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}__${i}`);
  await SecureStore.deleteItemAsync(countKey(key));
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) return AsyncStorage.setItem(key, value);
  await removeItem(key); // значение могло стать короче → не оставляем «хвостовые» чанки
  const chunks = Math.max(1, Math.ceil(value.length / CHUNK));
  for (let i = 0; i < chunks; i++) {
    await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  await SecureStore.setItemAsync(countKey(key), String(chunks));
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return AsyncStorage.getItem(key);
  const n = await SecureStore.getItemAsync(countKey(key));
  if (n == null) {
    // разовая миграция: прежняя сессия в открытом AsyncStorage → переносим в SecureStore
    const legacy = await AsyncStorage.getItem(key);
    if (legacy != null) {
      await setItem(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    }
    return null;
  }
  const count = parseInt(n, 10);
  let out = '';
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}__${i}`);
    if (part == null) return null; // чанк потерян → считаем сессию невалидной (перелогин)
    out += part;
  }
  return out;
}

export const secureStorage = { getItem, setItem, removeItem };
