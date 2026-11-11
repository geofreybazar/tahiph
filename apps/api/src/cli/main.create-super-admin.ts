/**
 * Bootstrap the first Super Admin.
 *
 *   printf '%s' "$PASSWORD" | node dist/cli/main.create-super-admin.js --email ops@tahi.ph --name "Ops"
 *
 * The password is read from stdin (or SUPER_ADMIN_PASSWORD), never from argv, so it does not
 * appear in shell history or the process list. Requires DATABASE_URL.
 */
import { createPrismaClient } from '@tahi/database';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createSuperAdmin } from './create-super-admin.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const url = process.env.DATABASE_URL;
  if (!url || !values.email || !values.name) {
    console.error(
      'Usage: printf %s "$PASSWORD" | node dist/cli/main.create-super-admin.js --email <email> --name <name>',
    );
    console.error('Requires DATABASE_URL. The password comes from stdin or SUPER_ADMIN_PASSWORD.');
    process.exit(2);
  }
  const password = process.env.SUPER_ADMIN_PASSWORD ?? (await readStdin());
  const prisma = createPrismaClient({ connectionString: url, max: 1 });
  try {
    const admin = await createSuperAdmin(prisma, {
      email: values.email,
      name: values.name,
      password,
    });
    process.stdout.write(
      `Created Super Admin ${admin.email} (${admin.id}). Sign in at the admin host to set up 2FA.\n`,
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(
        `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ')}`,
      );
    } else {
      console.error(err instanceof Error ? err.message : 'Failed to create the Super Admin.');
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
