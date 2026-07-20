// Production-safe Bear+ access smoke. Creates one temporary user, verifies that only
// admin can read Maria's sanitized OURA snapshot, then deletes the temporary user.
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
const email = `smoke.bear.plus.${stamp}@example.com`;
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

  const { error: roleError } = await admin
    .from('user_roles')
    .update({ role: 'admin' })
    .eq('user_id', userId);
  if (roleError) throw roleError;

  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data, error } = await client.functions.invoke('oura-sync', {
    body: { partner: true, readOnly: true },
  });
  if (error) throw error;
  assert(data && Object.hasOwn(data, 'snap'), 'admin_response_shape');
  assert(data.snap?.date, 'maria_snapshot_present');
  assert(!Object.hasOwn(data.snap, 'raw'), 'raw_not_exposed');
  assert(!Object.hasOwn(data.snap, 'user_id'), 'user_id_not_exposed');

  const { error: downgradeError } = await admin
    .from('user_roles')
    .update({ role: 'grip' })
    .eq('user_id', userId);
  if (downgradeError) throw downgradeError;
  const denied = await client.functions.invoke('oura-sync', {
    body: { partner: true, readOnly: true },
  });
  assert(Boolean(denied.error), 'grip_must_be_denied');

  console.log('bear plus smoke: PASS');
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup_failed:${error.message}`);
  }
}
