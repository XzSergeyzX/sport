// Общие помощники дат для экранов (Головна/Тренування/Здоров'я) — единый формат,
// чтобы одна и та же тренировка не показывалась разными строками на разных вкладках.

/** «21.06.26, сб» — спершу дата, потім (після коми) день тижня, мовою застосунку. */
export function humanDate(iso: string, locale: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
  const wd = d.toLocaleDateString(locale, { weekday: 'short' });
  return `${date}, ${wd}`;
}

/**
 * Сегодняшняя дата в ЛОКАЛЬНОМ времени (YYYY-MM-DD) — для сверки с днём снимка OURA.
 * НЕ toISOString(): тот даёт UTC-день, и вечером в западных поясах «сегодня» уезжает
 * на завтра → свежий снимок помечался бы как устаревший (и наоборот утром к востоку).
 */
export function localYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
