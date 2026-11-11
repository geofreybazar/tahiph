import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TenantDatabase } from '@tahi/database';
import type { UpdateStaffMemberRequest } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { SessionService } from '../../core/auth/session.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../core/http/domain-error.js';

const MEMBER_SELECT = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  user: { select: { name: true, email: true } },
  role: { select: { id: true, key: true, name: true } },
} as const;

type MemberRow = Prisma.TenantMembershipGetPayload<{ select: typeof MEMBER_SELECT }>;

const toMember = (m: MemberRow) => ({
  membershipId: m.id,
  userId: m.userId,
  name: m.user.name,
  email: m.user.email,
  role: m.role,
  status: m.status,
  joinedAt: m.createdAt.toISOString(),
});

/** Staff of the active atelier (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3.4, ADR-024). */
@Injectable()
export class StaffService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  // shortcut: unpaginated; staff counts are bounded by plan seats. Paginate if seats exceed ~200.
  async list() {
    const rows = await this.tenantDb.db().tenantMembership.findMany({
      orderBy: { createdAt: 'asc' },
      select: MEMBER_SELECT,
    });
    return rows.map(toMember);
  }

  /** A member of this atelier; another atelier's membership is not found (404). */
  async member(membershipId: string) {
    const m = await this.tenantDb.db().tenantMembership.findFirst({
      where: { id: membershipId },
      select: MEMBER_SELECT,
    });
    if (!m) throw new NotFoundError('Staff member not found.');
    return toMember(m);
  }

  /** A member who can be given work now (appointments, assignments). */
  async activeMember(membershipId: string) {
    const m = await this.member(membershipId);
    if (m.status !== 'ACTIVE') {
      throw new DomainError('STAFF_INACTIVE', 'This staff member is not active.');
    }
    return m;
  }

  async activeMembers() {
    const rows = await this.tenantDb.db().tenantMembership.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: MEMBER_SELECT,
    });
    return rows.map(toMember);
  }

  /**
   * Changes a member's role or status. Nobody changes their own membership or the owner's,
   * and nobody is given the owner role (ownership is transferred, not assigned).
   */
  async update(membershipId: string, input: UpdateStaffMemberRequest, ip: string) {
    const actorId = requireContext(this.cls, 'userId');
    const updated = await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      const member = await db.tenantMembership.findFirst({
        where: { id: membershipId },
        select: MEMBER_SELECT,
      });
      if (!member) throw new NotFoundError('Staff member not found.');
      if (member.id === requireContext(this.cls, 'membershipId')) {
        throw new ForbiddenError('CANNOT_CHANGE_SELF', 'You cannot change your own membership.');
      }
      if (member.role.key === 'owner') {
        throw new ForbiddenError('OWNER_PROTECTED', 'The owner’s membership cannot be changed.');
      }
      if (input.status && member.status === 'INVITED') {
        throw new DomainError('MEMBERSHIP_PENDING', 'This invitation has not been accepted yet.');
      }
      if (input.roleId) {
        const role = await db.role.findFirst({
          where: { id: input.roleId },
          select: { key: true },
        });
        if (!role) throw new NotFoundError('Role not found.');
        if (role.key === 'owner') {
          throw new DomainError('ROLE_NOT_ASSIGNABLE', 'Ownership is transferred, not assigned.');
        }
      }
      const row = await db.tenantMembership.update({
        where: { id: member.id },
        data: input,
        select: MEMBER_SELECT,
      });
      await this.audit.tenant({
        actorType: 'USER',
        actorId,
        action: 'membership.updated',
        targetType: 'membership',
        targetId: member.id,
        ip,
        metadata: {
          ...(input.roleId ? { fromRoleId: member.role.id, toRoleId: input.roleId } : {}),
          ...(input.status ? { fromStatus: member.status, toStatus: input.status } : {}),
        },
      });
      return row;
    });
    // After commit: the guard already rejects a disabled membership on every request; this
    // also ends the sessions so they cannot be resumed if the member is re-enabled.
    if (input.status === 'DISABLED') await this.sessions.revokeForMembership(updated.id);
    return toMember(updated);
  }
}
