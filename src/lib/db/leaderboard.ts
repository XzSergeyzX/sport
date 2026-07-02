import { supabase } from '@/lib/supabase';

// Лидерборды комьюнити (см. миграцию 20260702130000): два борда — динамометры (кг) и
// эспандеры (RGC внутри сет-типа tns/card/deep). Наружу видны только approved-заявки
// через security definer RPC get_leaderboard; свои заявки любого статуса — прямым select
// (RLS lb_select_own). Видео не храним — только https-URL пруфа.

export type Board = 'dynamometer' | 'gripper';
export type GripSetType = 'tns' | 'card' | 'deep';
export type EntryStatus = 'pending' | 'approved' | 'rejected';

export type Dynamometer = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

/** Строка публичной витрины (get_leaderboard / get_leaderboard_pending). */
export type LeaderboardRow = {
  entry_id: string;
  user_id: string;
  display_name: string;
  avatar: string | null;
  bodyweight?: number | null; // кг, из профиля участника (только в approved-витрине)
  board?: Board; // только в pending-RPC
  dynamometer: string | null;
  weight_kg: number | null;
  gripper_brand: string | null;
  gripper_name: string | null;
  gripper_rgc: number | null;
  gripper_rgc_unit: 'kg' | 'lb' | null;
  set_type: GripSetType | null;
  certified: boolean;
  video_url: string;
  note?: string | null;
  performed_at: string | null;
  verified_at?: string | null;
  created_at?: string;
};

/** Своя заявка (прямой select с джойнами справочников). */
export type MyEntry = {
  id: string;
  board: Board;
  weight_kg: number | null;
  set_type: GripSetType | null;
  certified: boolean;
  video_url: string;
  note: string | null;
  performed_at: string | null;
  status: EntryStatus;
  created_at: string;
  dynamometers: { name: string } | null;
  grippers: { brand: string | null; name: string; rgc: number | null; rgc_unit: string | null } | null;
};

export async function listDynamometers(): Promise<Dynamometer[]> {
  const { data, error } = await supabase
    .from('dynamometers')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as Dynamometer[];
}

export async function getLeaderboard(board: Board): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_board: board });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function listMyEntries(userId: string): Promise<MyEntry[]> {
  const { data, error } = await supabase
    .from('leaderboard_entries')
    .select(
      'id, board, weight_kg, set_type, certified, video_url, note, performed_at, status, created_at, dynamometers(name), grippers(brand, name, rgc, rgc_unit)',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MyEntry[];
}

// Разрешённые видеохосты пруфов (зеркало check-констрейнта в БД): произвольный сайт на
// борд не подсунуть — по ссылкам ходят чужие люди.
export const VIDEO_HOST_RE =
  /^https:\/\/(www\.|m\.|vm\.|vt\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|facebook\.com|fb\.watch)\//i;

export type SubmitInput = {
  userId: string;
  videoUrl: string;
  note?: string | null;
  certified: boolean;
} & (
  | { board: 'dynamometer'; dynamometerId: string; weightKg: number }
  | { board: 'gripper'; gripperId: string; setType: GripSetType }
);

export async function submitEntry(input: SubmitInput): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: input.userId,
    board: input.board,
    video_url: input.videoUrl.trim().slice(0, 300),
    note: input.note?.trim().slice(0, 300) || null,
    certified: input.certified,
  };
  if (input.board === 'dynamometer') {
    row.dynamometer_id = input.dynamometerId;
    row.weight_kg = input.weightKg;
  } else {
    row.gripper_id = input.gripperId;
    row.set_type = input.setType;
  }
  const { error } = await supabase.from('leaderboard_entries').insert(row);
  if (error) throw error;
}

/** Отозвать свою заявку (pending — правка передумал; approved — право убрать себя с борда). */
export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('leaderboard_entries').delete().eq('id', id);
  if (error) throw error;
}

// ---- модерация (только admin; проверка роли — внутри RPC) ----

export async function listPendingEntries(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('get_leaderboard_pending');
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export async function reviewEntry(entryId: string, action: 'approved' | 'rejected'): Promise<void> {
  const { error } = await supabase.rpc('review_leaderboard_entry', {
    p_entry: entryId,
    p_action: action,
  });
  if (error) throw error;
}

// ---- хелперы отображения ----

const LB_PER_KG = 2.2046226218;

/** RGC заявки в кг (сравнение силы эспандеров разных единиц замера). */
export function rowRgcKg(r: { gripper_rgc: number | null; gripper_rgc_unit: string | null }): number | null {
  if (r.gripper_rgc == null) return null;
  return r.gripper_rgc_unit === 'lb' ? r.gripper_rgc / LB_PER_KG : r.gripper_rgc;
}

/** Официальная сертификация существует только у CoC #3 / #3.5 / #4 (IronMind, мужчины) —
 *  для остальных железок и динамометров свитч в заявке не показываем. */
export function certEligibleGripper(g: { brand?: string | null; name: string }): boolean {
  const s = `${g.brand ?? ''} ${g.name}`.toLowerCase();
  return s.includes('coc') && /(?:^|[^\d.])(3(?:\.5)?|4)(?:$|[^\d.])/.test(s);
}

/** Номер CoC из названия железки строки борда («CoC #3.5» → «3.5»); null, если не CoC 3/3.5/4. */
export function cocNumber(r: { gripper_brand: string | null; gripper_name: string | null }): string | null {
  const s = `${r.gripper_brand ?? ''} ${r.gripper_name ?? ''}`.toLowerCase();
  if (!s.includes('coc')) return null;
  const m = s.match(/(?:^|[^\d.])(3\.5|3|4)(?:$|[^\d.])/);
  return m ? m[1] : null;
}

/** «CoC 3, 3.5 Certified» на юзера — из ВСЕХ его approved-заявок борда (не только лучшей). */
export function certLabels(rows: LeaderboardRow[]): Map<string, string> {
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.certified) continue;
    const n = cocNumber(r);
    if (!n) continue;
    const set = byUser.get(r.user_id) ?? new Set<string>();
    set.add(n);
    byUser.set(r.user_id, set);
  }
  const out = new Map<string, string>();
  for (const [uid, set] of byUser) {
    const nums = [...set].sort((a, b) => parseFloat(a) - parseFloat(b));
    out.set(uid, `CoC ${nums.join(', ')} Certified`);
  }
  return out;
}

/** Лучший результат на юзера в пределах текущего фильтра (борд уже отфильтрован).
 *  Тай-брейк — сертификация: официально засчитанное закрытие выше домашнего при равном
 *  результате (и внутри юзера, и в общем ранжире). */
export function bestPerUser(rows: LeaderboardRow[], metric: (r: LeaderboardRow) => number | null): LeaderboardRow[] {
  const score = (r: LeaderboardRow) => (metric(r) ?? -1) + (r.certified ? 0.0001 : 0);
  const best = new Map<string, LeaderboardRow>();
  for (const r of rows) {
    const cur = best.get(r.user_id);
    if (!cur || score(r) > score(cur)) best.set(r.user_id, r);
  }
  return [...best.values()].sort((a, b) => score(b) - score(a));
}
