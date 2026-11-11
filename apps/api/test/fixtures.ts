import type { DatabaseClient, MembershipStatus, TenantStatus } from '@tahi/database';
import type { TenantPermission } from '@tahi/types';
import { randomUUID } from 'node:crypto';

/**
 * Integration fixtures. Tests run as a non-superuser role without BYPASSRLS, so tenant rows
 * are written inside a transaction that sets app.tenant_id, exactly like the application.
 * Every fixture uses unique slugs/emails, so tests never need to clean up.
 */
export const suffix = () => randomUUID().slice(0, 8);

export async function asTenant<T>(
  prisma: DatabaseClient,
  tenantId: string,
  fn: (tx: Parameters<Parameters<DatabaseClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

export async function createUser(prisma: DatabaseClient, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  return prisma.user.create({
    data: { email: `u-${suffix()}@example.test`, name: 'Test User', passwordHash: 'x', status },
  });
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  hostname: string;
  roles: Record<string, string>;
}

/** A tenant with a verified subdomain and the given roles (key → permissions). */
export async function createTenant(
  prisma: DatabaseClient,
  roles: Record<string, TenantPermission[]>,
  opts: { status?: TenantStatus; verified?: boolean } = {},
): Promise<TenantFixture> {
  const slug = `t-${suffix()}`;
  const hostname = `${slug}.tahi.test`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: `Atelier ${slug}`,
      status: opts.status ?? 'ACTIVE',
      domains: {
        create: {
          hostname,
          type: 'SUBDOMAIN',
          isPrimary: true,
          verifiedAt: opts.verified === false ? null : new Date(),
        },
      },
    },
  });
  const roleIds: Record<string, string> = {};
  await asTenant(prisma, tenant.id, async (tx) => {
    for (const [key, permissions] of Object.entries(roles)) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          key,
          name: key,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
      });
      roleIds[key] = role.id;
    }
  });
  return { tenantId: tenant.id, slug, hostname, roles: roleIds };
}

export async function addMember(
  prisma: DatabaseClient,
  tenant: TenantFixture,
  userId: string,
  roleKey: string,
  status: MembershipStatus = 'ACTIVE',
) {
  const roleId = tenant.roles[roleKey];
  if (!roleId) throw new Error(`no role ${roleKey}`);
  return asTenant(prisma, tenant.tenantId, (tx) =>
    tx.tenantMembership.create({ data: { tenantId: tenant.tenantId, userId, roleId, status } }),
  );
}
