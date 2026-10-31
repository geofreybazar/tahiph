import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createBasePrisma } from '../src/common/prisma/prisma-clients';

/**
 * Browser tests run in throwaway tenants, so they never touch seed or dev data and can assert
 * exact totals. `up` removes anything left by a crashed run, then creates them; `down` removes them.
 * Everything it owns starts with e2e-: tenant slugs and user emails.
 */
const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, NODE_ENV } = process.env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY in .env');
}
// It deletes data and creates accounts with a known password.
const isLocal = (url: string) => /(@|\/\/)(127\.0\.0\.1|localhost)[:/]/.test(url);
if (NODE_ENV === 'production' || !isLocal(DATABASE_URL) || !isLocal(SUPABASE_URL)) {
  throw new Error('The browser test fixture only runs against local databases');
}

const PREFIX = 'e2e-';
const PASSWORD = 'e2e-local-password';
const prisma = createBasePrisma(DATABASE_URL);
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function removeAll() {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const tenantId = { in: tenants.map((tenant) => tenant.id) };
  const where = { tenantId };

  const files = await prisma.mediaFile.findMany({ where, select: { objectKey: true } });
  if (files.length > 0) {
    const { error } = await supabase.storage
      .from('private-media')
      .remove(files.map((file) => file.objectKey));
    if (error) throw error;
  }

  // Children before parents: every relation here is ON DELETE RESTRICT.
  await prisma.appointment.deleteMany({ where });
  await prisma.payment.deleteMany({ where });
  await prisma.expense.deleteMany({ where });
  await prisma.paymentScheduleItem.deleteMany({ where });
  await prisma.garmentMedia.deleteMany({ where });
  await prisma.garmentStageEvent.deleteMany({ where });
  await prisma.garment.deleteMany({ where });
  await prisma.measurementValue.deleteMany({ where });
  await prisma.measurementRecord.deleteMany({ where });
  await prisma.measurementProfile.deleteMany({ where });
  await prisma.weddingProject.deleteMany({ where });
  await prisma.client.deleteMany({ where });
  await prisma.mediaFile.deleteMany({ where });
  await prisma.documentCounter.deleteMany({ where });
  await prisma.tenantInvitation.deleteMany({ where });
  await prisma.tenantMembership.deleteMany({ where });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.auditLog.deleteMany({
    where: { OR: [{ tenantId }, { actorUserId: { in: userIds } }] },
  });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.platformAdmin.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const user of data.users) {
    if (user.email?.startsWith(PREFIX)) await supabase.auth.admin.deleteUser(user.id);
  }
}

async function up() {
  await removeAll();
  const run = Date.now().toString(36);
  const newUser = async (role: string) => {
    const email = `${PREFIX}${role}-${run}@example.test`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    await prisma.user.create({ data: { id: data.user.id, email } });
    return { id: data.user.id, email };
  };
  const newTenant = (name: string, slug: string) =>
    prisma.tenant.create({ data: { name, slug: `${PREFIX}${slug}-${run}` } });

  const [a, b] = [await newTenant('E2E Atelier', 'a'), await newTenant('E2E Rival', 'b')];
  const [owner, staff, rival, platform, resetter] = [
    await newUser('owner'),
    await newUser('staff'),
    await newUser('rival'),
    await newUser('platform'),
    await newUser('resetter'),
  ];
  await prisma.tenantMembership.createMany({
    data: [
      { tenantId: a.id, userId: owner.id, role: 'owner' },
      { tenantId: a.id, userId: staff.id, role: 'staff' },
      { tenantId: a.id, userId: resetter.id, role: 'staff' },
      { tenantId: b.id, userId: rival.id, role: 'owner' },
    ],
  });
  await prisma.platformAdmin.create({ data: { userId: platform.id } });

  writeFileSync(
    process.argv[3]!,
    JSON.stringify({
      run,
      password: PASSWORD,
      owner: owner.email,
      staff: staff.email,
      rival: rival.email,
      platform: platform.email,
      resetter: resetter.email,
    }),
  );
}

const command = process.argv[2];
(command === 'up'
  ? up()
  : command === 'down'
    ? removeAll()
    : Promise.reject(new Error('up or down'))
)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
