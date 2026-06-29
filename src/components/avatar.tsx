import { Image, Text, View } from 'react-native';

import { avatarSource } from '@/lib/avatars';

// инициалы из email для дефолтного кружка
export function initials(email?: string | null): string {
  const local = (email ?? '').trim().split('@')[0];
  if (!local) return '?';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return chars.toUpperCase();
}

/** Аватар: картинка выбранного пресета, иначе кружок с инициалами. */
export function Avatar({
  email,
  avatarKey,
  size = 48,
}: {
  email?: string | null;
  avatarKey?: string | null;
  size?: number;
}) {
  const src = avatarSource(avatarKey);
  if (src) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      className="items-center justify-center bg-graphite-800"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Text className="font-bold text-accent" style={{ fontSize: Math.round(size * 0.36) }}>
        {initials(email)}
      </Text>
    </View>
  );
}
