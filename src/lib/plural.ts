// Множинні форми вручну: Hermes (Expo Go) не гарантує Intl.PluralRules для української,
// тому категорію CLDR рахуємо самі. Форми рядків — у locales/*.json під ключем `count.*`.
type TFn = (key: string, opts?: Record<string, unknown>) => string;

export type CountKind = 'exercises' | 'sets' | 'reps' | 'days' | 'workouts';

function category(lang: string, n: number): 'one' | 'few' | 'many' | 'other' {
  if (lang === 'uk') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
    return 'many';
  }
  return n === 1 ? 'one' : 'other';
}

/** «{n} вправ» з правильною формою для en/uk. */
export function pluralCount(t: TFn, lang: string, kind: CountKind, n: number): string {
  return t(`count.${kind}.${category(lang, n)}`, { n });
}
