// Клиентский генератор UUID v4.
// Зачем: для offline-first (SPEC §4) сущности (тренировка / упражнение / подход) должны
// создаваться со СТАБИЛЬНЫМ id ещё до похода в сеть — тогда их можно ссылать локально и потом
// идемпотентно синкать в Postgres (upsert по id). Postgres-колонки `id uuid` принимают
// переданный id; дефолт `gen_random_uuid()` срабатывает только когда id не передан.
// Криптостойкость для первичного ключа не нужна — берём crypto.getRandomValues, если доступен
// (нативка/web), иначе fallback на Math.random (Hermes без полифила crypto).

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

export function newId(): string {
  const b = new Uint8Array(16);
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (g?.getRandomValues) g.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // версия 4
  b[8] = (b[8] & 0x3f) | 0x80; // вариант 10xx
  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-' +
    HEX[b[4]] + HEX[b[5]] + '-' +
    HEX[b[6]] + HEX[b[7]] + '-' +
    HEX[b[8]] + HEX[b[9]] + '-' +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  );
}
