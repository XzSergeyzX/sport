// Production-safe integration smoke for dynamometer hand rankings.
// Creates one temporary auth user, verifies all views, then deletes it (entries cascade).
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '';
const envValue = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || envValue('EXPO_PUBLIC_SUPABASE_URL');
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || envValue('EXPO_PUBLIC_SUPABASE_ANON_KEY')
  || 'sb_publishable_-RWMi2w3VGgM_b_NjCxMVQ_LfKmD14i';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || envValue('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !anon || !service) throw new Error('missing_supabase_env');

const admin = createClient(url, service, { auth: { persistSession: false } });
const client = createClient(url, anon, { auth: { persistSession: false } });
const stamp = Date.now();
const email = `smoke.lb.hands.${stamp}@example.com`;
const password = `Smoke-${stamp}-Aa1!`;
let userId;

const assert = (condition, message) => {
  if (!condition) throw new Error(`assertion_failed:${message}`);
};

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  userId = created.user.id;

  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: devices, error: devicesError } = await client
    .from('dynamometers')
    .select('id, code')
    .in('code', ['gm150', 'xf300_14mm'])
    .eq('is_active', true);
  if (devicesError) throw devicesError;
  const gm = devices.find((d) => d.code === 'gm150');
  const xf = devices.find((d) => d.code === 'xf300_14mm');
  assert(gm && xf, 'required_devices');

  const rows = [
    [gm.id, 'left', 60],
    [gm.id, 'left', 65],
    [gm.id, 'right', 55],
    [xf.id, 'left', 70],
    [xf.id, 'right', 50],
  ].map(([dynamometer_id, hand, weight_kg], index) => ({
    user_id: userId,
    board: 'dynamometer',
    dynamometer_id,
    hand,
    weight_kg,
    video_url: `https://youtube.com/watch?v=smokehands${stamp}${index}`,
    note: 'smoke-leaderboard-hands',
  }));
  const { data: inserted, error: insertError } = await client
    .from('leaderboard_entries')
    .insert(rows)
    .select('id');
  if (insertError) throw insertError;

  const { error: approveError } = await admin
    .from('leaderboard_entries')
    .update({ status: 'approved', verified_at: new Date().toISOString() })
    .in('id', inserted.map((row) => row.id));
  if (approveError) throw approveError;

  const get = async (code, view) => {
    const { data, error } = await client.rpc('get_leaderboard', {
      p_board: 'dynamometer',
      p_dynamometer_code: code,
      p_set_type: null,
      p_dynamometer_view: view,
    });
    if (error) throw error;
    return data.find((row) => row.user_id === userId);
  };

  assert((await get('gm150', 'device_all'))?.weight_kg === 65, 'device_all');
  assert((await get('gm150', 'left'))?.weight_kg === 65, 'left');
  assert((await get('gm150', 'right'))?.weight_kg === 55, 'right');
  const sum = await get('gm150', 'sum');
  assert(sum?.weight_kg === 120, 'sum');
  assert(sum?.left_weight_kg === 65 && sum?.right_weight_kg === 55, 'sum_breakdown');
  assert(sum?.left_video_url === rows[1].video_url, 'sum_left_proof');
  assert(sum?.right_video_url === rows[2].video_url, 'sum_right_proof');
  const absolute = await get(null, 'absolute');
  assert(absolute?.weight_kg === 70 && absolute?.dynamometer_code === 'xf300_14mm', 'absolute');

} finally {
  if (userId) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
    if (cleanupError) throw cleanupError;
  }
}

console.log('leaderboard hand smoke: PASS');
