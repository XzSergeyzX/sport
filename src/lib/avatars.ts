import type { ImageSourcePropType } from 'react-native';

// Пресет-аватарки. Картинки лежат в assets/avatars/ и бандлятся с апкой.
// React Native требует СТАТИЧЕСКИЙ require() (Metro не умеет require по строке),
// поэтому список явный.
//
// ➕ Добавить аватарку: положи файл в assets/avatars/<key>.png и впиши строку:
//    { key: '01', source: require('../../assets/avatars/01.png') },
// Требования к файлу: квадрат, PNG (или JPG), ~256–512px, key — короткий и
// уникальный (имя файла без расширения).
export type AvatarPreset = { key: string; source: ImageSourcePropType };

export const AVATARS: AvatarPreset[] = [
  { key: 'boy', source: require('../../assets/avatars/boy.png') },
  { key: 'girl', source: require('../../assets/avatars/girl.png') },
  { key: 'foxM', source: require('../../assets/avatars/foxM.png') },
  { key: 'foxF', source: require('../../assets/avatars/foxF.png') },
  { key: 'cat', source: require('../../assets/avatars/cat.png') },
  { key: 'dog', source: require('../../assets/avatars/dog.png') },
  { key: 'panda', source: require('../../assets/avatars/panda.png') },
  { key: 'gorilla', source: require('../../assets/avatars/gorilla.png') },
];

/** Источник картинки по ключу; null — если ключ пуст или пресет не найден (→ инициалы). */
export function avatarSource(key: string | null | undefined): ImageSourcePropType | null {
  if (!key) return null;
  return AVATARS.find((a) => a.key === key)?.source ?? null;
}
