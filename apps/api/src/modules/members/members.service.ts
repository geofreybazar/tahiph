import { Inject, Injectable } from '@nestjs/common';
import { CreateInvitation, TenantRole } from '@tahi/shared';
import { AuditService } from '../../common/auth/audit.service';
import { InvitationIssuer } from '../../common/auth/invitation-issuer';
import { ApiException } from '../../common/http/api-exception';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';

const forbidden = () => new ApiException(403, 'FORBIDDEN', 'Your role does not allow this');
const notFound = () => new ApiException(404, 'NOT_FOUND', 'Member not found');

@Injectable()
export class MembersService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly context: RequestContext,
    private readonly issuer: InvitationIssuer,
    private readonly audit: AuditService,
  ) {}

  /** Admins manage staff only. Nobody changes the owner here; that's a transfer. */
  private assertCanManage(targetRole: TenantRole, newRole?: TenantRole): void {
    if (targetRole === 'owner') throw forbidden();
    if (this.context.role === 'owner') return;
    if (targetRole !== 'staff' || (newRole && newRole !== 'staff')) throw forbidden();
  }

  async listMembers() {
    const members = await this.db.tenantMembership.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { email: true, fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(({ user, ...member }) => ({ ...member, ...user }));
  }

  async changeRole(id: string, role: TenantRole) {
    const member = await this.db.tenantMembership.findFirst({ where: { id, status: 'active' } });
    if (!member) throw notFound();
    this.assertCanManage(member.role, role);

    await this.db.tenantMembership.update({ where: { id }, data: { role } });
    await this.audit.record({
      action: 'member.role_changed',
      entityType: 'tenant_membership',
      entityId: id,
      metadata: { from: member.role, to: role },
    });
    return { id, role };
  }

  async remove(id: string): Promise<void> {
    const member = await this.db.tenantMembership.findFirst({ where: { id, status: 'active' } });
    if (!member) throw notFound();
    this.assertCanManage(member.role);

    await this.db.tenantMembership.update({ where: { id }, data: { status: 'removed' } });
    await this.audit.record({
      action: 'member.removed',
      entityType: 'tenant_membership',
      entityId: id,
    });
  }

  async transferOwnership(membershipId: string): Promise<void> {
    const target = await this.db.tenantMembership.findFirst({
      where: { id: membershipId, status: 'active' },
    });
    if (!target) throw notFound();
    if (target.role === 'owner') {
      throw new ApiException(409, 'CONFLICT', 'This member is already the owner');
    }

    const userId = this.context.principal!.userId;
    await this.db.$transaction(async (tx) => {
      // In this order, because a unique index allows only one active owner at a time.
      await tx.tenantMembership.updateMany({
        where: { userId, role: 'owner' },
        data: { role: 'admin' },
      });
      await tx.tenantMembership.update({ where: { id: membershipId }, data: { role: 'owner' } });
    });
    await this.audit.record({
      action: 'member.ownership_transferred',
      entityType: 'tenant_membership',
      entityId: membershipId,
    });
  }

  async invite({ email, role }: CreateInvitation) {
    this.assertCanManage(role, role);
    const existing = await this.db.tenantMembership.findFirst({
      where: { status: 'active', user: { is: { email } } },
    });
    if (existing) throw new ApiException(409, 'CONFLICT', 'This person is already a member');

    return this.issuer.issue(this.context.tenantId!, email, role, this.context.principal!.userId);
  }

  listInvitations() {
    return this.db.tenantInvitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      // Never the token hash.
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(id: string): Promise<void> {
    const invitation = await this.db.tenantInvitation.findFirst({
      where: { id, acceptedAt: null },
    });
    if (!invitation) throw new ApiException(404, 'NOT_FOUND', 'Invitation not found');
    await this.db.tenantInvitation.delete({ where: { id } });
  }

  async acceptInvitation(token: string) {
    const { userId, email } = this.context.principal!;
    return this.issuer.accept(token, userId, email);
  }

  getTenant() {
    return this.db.tenant.findFirstOrThrow({
      select: { id: true, name: true, slug: true, status: true },
    });
  }

  updateTenant(name: string) {
    return this.db.tenant.update({
      where: { id: this.context.tenantId! },
      data: { name },
      select: { id: true, name: true, slug: true, status: true },
    });
  }
}
