// Read-only preflight перед 20260716120000_private_features_and_active_workout.sql.
// Показывает фактические роли и дубли активных тренировок; ничего не изменяет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const envText = readFileSync(join(ROOT, '.env'), 'utf8');
const envValue = (name) => envText.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || envValue('EXPO_PUBLIC_SUPABASE_URL');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || envValue('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('Supabase URL/service-role key not found');

const admin = createClient(url, key, { auth: { persistSession: false } });
const [{ data: usersPage, error: usersError }, { data: roles, error: rolesError }, activeResult] =
  await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from('user_roles').select('user_id, role').order('updated_at'),
    admin.from('workouts').select('id, user_id, started_at').is('ended_at', null).order('started_at'),
  ]);

if (usersError) throw usersError;
if (rolesError) throw rolesError;
if (activeResult.error) throw activeResult.error;

const users = new Map((usersPage.users ?? []).map((user) => [user.id, user]));
console.log('ROLES');
for (const row of roles ?? []) {
  const user = users.get(row.user_id);
  console.log(`${user?.email ?? '(no email)'}\t${row.role}\t${row.user_id}`);
}

const activeByUser = new Map();
for (const workout of activeResult.data ?? []) {
  const list = activeByUser.get(workout.user_id) ?? [];
  list.push(workout);
  activeByUser.set(workout.user_id, list);
}

console.log('\nACTIVE_WORKOUTS');
if (activeByUser.size === 0) console.log('none');
for (const [userId, workouts] of activeByUser) {
  const user = users.get(userId);
  console.log(`${user?.email ?? '(no email)'}\tcount=${workouts.length}`);
  for (const workout of workouts) console.log(`  ${workout.id}\t${workout.started_at}`);
}

const duplicateCount = [...activeByUser.values()].filter((workouts) => workouts.length > 1).length;
console.log(`\nSUMMARY roles=${roles?.length ?? 0} active_users=${activeByUser.size} duplicate_users=${duplicateCount}`);
