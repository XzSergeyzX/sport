import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { type AppLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { WeightUnit } from '@/lib/use-unit';

/** Применить и сохранить язык: i18n + AsyncStorage + (best-effort) профиль. */
export async function applyLanguage(lang: AppLanguage, userId?: string): Promise<void> {
  i18n.changeLanguage(lang);
  await AsyncStorage.setItem('app.language', lang);
  if (userId) {
    try {
      await supabase.from('profile').update({ language: lang }).eq('user_id', userId);
    } catch {
      // оффлайн / БД недоступна — локального кэша достаточно
    }
  }
}

/** Сохранить единицу веса: AsyncStorage + (best-effort) профиль. */
export async function applyUnit(unit: WeightUnit, userId?: string): Promise<void> {
  await AsyncStorage.setItem('app.weightUnit', unit);
  if (userId) {
    try {
      await supabase.from('profile').update({ units: unit }).eq('user_id', userId);
    } catch {
      // см. выше
    }
  }
}

/** Сохранённый язык для восстановления на старте приложения (до маршрутизации). */
export async function loadStoredLanguage(): Promise<AppLanguage | null> {
  const v = await AsyncStorage.getItem('app.language');
  return v === 'uk' || v === 'en' ? v : null;
}
