import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createBasePrisma } from '../src/common/prisma/prisma-clients';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, NODE_ENV } = process.env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY in .env');
}

// It creates accounts with a known password, so it must never touch a shared environment.
const isLocal = (url: string) => /(@|\/\/)(127\.0\.0\.1|localhost)[:/]/.test(url);
if (NODE_ENV === 'production' || !isLocal(DATABASE_URL) || !isLocal(SUPABASE_URL)) {
  throw new Error('The seed script only runs against local databases');
}

const PASSWORD = 'local-dev-password';
const prisma = createBasePrisma(DATABASE_URL);
const auth = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;

async function ensureUser(email: string): Promise<string> {
  const { data, error } = await auth.listUsers({ perPage: 1000 });
  if (error) throw error;
  let id = data.users.find((user) => user.email === email)?.id;
  if (!id) {
    const created = await auth.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error) throw created.error;
    id = created.data.user.id;
  }
  await prisma.user.upsert({ where: { id }, create: { id, email }, update: { email } });
  return id;
}

async function ensureTenant(slug: string, name: string): Promise<string> {
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name },
    update: { name },
  });
  return tenant.id;
}

async function ensureMember(tenantId: string, userId: string, role: 'owner' | 'admin' | 'staff') {
  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, role },
    update: { role, status: 'active' },
  });
}

async function ensureClient(tenantId: string, fullName: string) {
  const existing = await prisma.client.findFirst({ where: { tenantId, fullName } });
  if (!existing) await prisma.client.create({ data: { tenantId, fullName } });
}

async function main() {
  const demo = await ensureTenant('demo', 'Demo Atelier');
  const other = await ensureTenant('other', 'Other Atelier');

  await ensureMember(demo, await ensureUser('owner@demo.test'), 'owner');
  await ensureMember(demo, await ensureUser('staff@demo.test'), 'staff');
  await ensureMember(other, await ensureUser('owner@other.test'), 'owner');

  const both = await ensureUser('both@demo.test');
  await ensureMember(demo, both, 'admin');
  await ensureMember(other, both, 'staff');

  const platform = await ensureUser('admin@tahi.test');
  await prisma.platformAdmin.upsert({
    where: { userId: platform },
    create: { userId: platform },
    update: {},
  });

  await ensureClient(demo, 'Alma Santos');
  await ensureClient(other, 'Bea Reyes');

  console.log(`Seeded. Sign in with any seed email and the password: ${PASSWORD}`);
}

main().finally(() => prisma.$disconnect());
