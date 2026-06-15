import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type WeightUnit = 'kg' | 'lb';

// Реактивный модульный стор: смена единицы мгновенно обновляет все экраны,
// которые читают useWeightUnit() (раньше значение бралось только на маунте).
let current: WeightUnit = 'kg';
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Установить единицу: обновляет стор + персистит в AsyncStorage. */
export function setWeightUnit(unit: WeightUnit): void {
  if (unit === current) return;
  current = unit;
  emit();
  AsyncStorage.setItem('app.weightUnit', unit).catch(() => {});
}

/** Поднять сохранённую единицу на старте приложения. */
export async function initWeightUnit(): Promise<void> {
  const v = await AsyncStorage.getItem('app.weightUnit');
  if ((v === 'kg' || v === 'lb') && v !== current) {
    current = v;
    emit();
  }
}

export function useWeightUnit(): WeightUnit {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
