import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type WeightUnit = 'kg' | 'lb';

/** Единица веса из профиля (закэширована в AsyncStorage на гейте/онбординге). */
export function useWeightUnit(): WeightUnit {
  const [unit, setUnit] = useState<WeightUnit>('kg');
  useEffect(() => {
    AsyncStorage.getItem('app.weightUnit').then((v) => {
      if (v === 'kg' || v === 'lb') setUnit(v);
    });
  }, []);
  return unit;
}
