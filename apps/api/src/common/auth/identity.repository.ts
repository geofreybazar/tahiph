import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { ApiException } from '../http/api-exception';
import { BASE_PRISMA } from '../prisma/base-prisma.token';
import { Principal } from '../request-context/request-context';

/** The lookups that must run before a tenant context exists. Nothing else belongs here. */
@Injectable()
export class IdentityRepository {
  constructor(@Inject(BASE_PRISMA) private readonly prisma: PrismaClient) {}

  async syncUser({ userId, email }: Principal): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (existing?.email === email) return;
    try {
      await this.prisma.user.upsert({
        where: { id: userId },
        create: { id: userId, email },
        update: { email },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      throw new ApiException(409, 'CONFLICT', 'This email belongs to another account');
    }
  }

  findActiveMembership(userId: string, tenantId: string) {
    return this.prisma.tenantMembership.findFirst({
      where: { userId, tenantId, status: 'active' },
      select: { role: true, tenant: { select: { status: true } } },
    });
  }

  listActiveMemberships(userId: string) {
    return this.prisma.tenantMembership.findMany({
      where: { userId, status: 'active' },
      select: {
        role: true,
        tenant: { select: { id: true, name: true, slug: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return (await this.prisma.platformAdmin.findUnique({ where: { userId } })) !== null;
  }
}
