import { Pressable, Text, View } from 'react-native';

export type SegmentOption<T extends string> = { value: T; label: string };

/** Сегментированный переключатель (язык, единицы и т.п.). Тёмная графит-палитра. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row rounded-2xl bg-graphite-800 p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            className={`flex-1 items-center rounded-xl py-3 ${selected ? 'bg-graphite-100' : ''}`}
          >
            <Text
              className={`text-base font-semibold ${selected ? 'text-graphite-950' : 'text-graphite-300'}`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
