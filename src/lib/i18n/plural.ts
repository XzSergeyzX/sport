import i18n from '@/lib/i18n';

// Склонение числительных. Делаем вручную, не полагаясь на Intl.PluralRules
// (в Hermes/RN он не всегда доступен), чтобы украинские формы были корректны.
function uk(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «5 повторів» / «5 reps» — число + склонённое слово. */
export function repsLabel(n: number): string {
  const word =
    i18n.language === 'uk' ? uk(n, 'повтор', 'повтори', 'повторів') : n === 1 ? 'rep' : 'reps';
  return `${n} ${word}`;
}

/** «5 підходів» / «5 sets». */
export function setsLabel(n: number): string {
  const word =
    i18n.language === 'uk' ? uk(n, 'підхід', 'підходи', 'підходів') : n === 1 ? 'set' : 'sets';
  return `${n} ${word}`;
}
