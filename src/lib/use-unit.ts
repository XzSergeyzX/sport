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

// ---- Конвертация веса (канонически храним в кг) ----
const LB_PER_KG = 2.2046226218;

/** кг → выбранная единица (число). */
export function fromKg(kg: number | null | undefined, unit: WeightUnit): number | null {
  if (kg == null) return null;
  return unit === 'lb' ? kg * LB_PER_KG : kg;
}

/** выбранная единица → кг (для записи). */
export function toKg(value: number | null | undefined, unit: WeightUnit): number | null {
  if (value == null) return null;
  return unit === 'lb' ? value / LB_PER_KG : value;
}

/** кг → строка в выбранной единице (целое без дробной части, иначе один знак). */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  const v = fromKg(kg, unit);
  if (v == null) return '';
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
