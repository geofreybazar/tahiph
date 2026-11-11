import type { DatabaseClient } from '@tahi/database';
import { emailSchema, passwordSchema, personNameSchema } from '@tahi/validation';
import { hashPassword } from '../core/auth/password.js';

export class SuperAdminExistsError extends Error {
  constructor() {
    super('A Super Admin already exists. Further admins are created from the admin dashboard.');
    this.name = 'SuperAdminExistsError';
  }
}

export interface CreateSuperAdminInput {
  email: string;
  name: string;
  password: string;
}

/**
 * Creates the first Super Admin (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.6). Refuses if
 * one exists, so the CLI cannot be used to add admins later. TOTP is enrolled at first login.
 * The check and insert run in one serializable transaction, so two concurrent runs cannot
 * both succeed.
 */
export async function createSuperAdmin(prisma: DatabaseClient, input: CreateSuperAdminInput) {
  const email = emailSchema.parse(input.email);
  const name = personNameSchema.parse(input.name);
  const password = passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(
    async (tx) => {
      if ((await tx.platformUser.count({ where: { role: 'SUPER_ADMIN' } })) > 0)
        throw new SuperAdminExistsError();
      const admin = await tx.platformUser.create({
        data: { email, name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true, email: true },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'platform.super_admin_created',
          targetType: 'platform_user',
          targetId: admin.id,
        },
      });
      return admin;
    },
    { isolationLevel: 'Serializable' },
  );
}
