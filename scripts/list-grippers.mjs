// READ-ONLY. Печатает личные эспандеры пользователя (для разбора матчинга при импорте).
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://sdvegejubjmmlnifvigt.supabase.co';
const KEY_FILE = join(dirname(fileURLToPath(import.meta.url)), '.service-role-key');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : undefined);
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
const me = users.users.find((u) => (u.email ?? '').includes('gonenko1995'));
const { data: g } = await db
  .from('grippers').select('brand, name, rgc, rgc_unit').eq('owner_id', me.id).order('name');

console.log(`Личные эспандеры (${(g ?? []).length}):`);
for (const x of g ?? []) console.log(`  ${x.brand ?? ''} ${x.name}  —  ${x.rgc}${x.rgc_unit}`);
if (!g?.length) console.log('  (личных нет)');
