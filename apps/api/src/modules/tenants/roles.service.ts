import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient, Prisma, TenantDatabase } from '@tahi/database';
import type { Permission } from '@tahi/types';
import type { CreateRoleRequest, UpdateRoleRequest } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { UNSCOPED_PRISMA } from '../../core/database/tokens.js';
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../core/http/domain-error.js';
import { permissionChangeProblems } from './role-rules.js';

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  isSystem: true,
  permissions: { select: { permission: true } },
  _count: { select: { memberships: true } },
} as const;

type RoleRow = {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: { permission: string }[];
  _count: { memberships: number };
};

const toRole = (r: RoleRow) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  isSystem: r.isSystem,
  permissions: r.permissions.map((p) => p.permission).sort(),
  memberCount: r._count.memberships,
});

/** Roles of the active atelier (docs/AUTHENTICATION_AND_AUTHORIZATION.md §7.2, ADR-025). */
@Injectable()
export class RolesService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    @Inject(UNSCOPED_PRISMA) private readonly prisma: DatabaseClient,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  private held(): ReadonlySet<Permission> {
    return this.cls.get('permissions') ?? new Set();
  }

  private audited(action: string, roleId: string, ip: string, metadata?: Prisma.InputJsonObject) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType: 'role',
      targetId: roleId,
      ip,
      ...(metadata ? { metadata } : {}),
    });
  }

  async list() {
    const rows = await this.tenantDb.db().role.findMany({
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      select: ROLE_SELECT,
    });
    return rows.map(toRole);
  }

  // shortcut: name uniqueness is checked, not constrained; two concurrent creates can both win. Add a unique index on (tenant_id, lower(name)) if it matters.
  private async assertNameFree(name: string, exceptId?: string) {
    const taken = await this.tenantDb.db().role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw new DomainError(
        'ROLE_NAME_TAKEN',
        'A role with this name exists.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async create(input: CreateRoleRequest, ip: string) {
    const problems = permissionChangeProblems([], input.permissions, this.held());
    if (problems.length) throw new ValidationFailedError(problems);
    return this.tenantDb.withTenantTx(async () => {
      await this.assertNameFree(input.name);
      const role = await this.tenantDb.db().role.create({
        data: {
          key: `custom-${randomUUID().slice(0, 8)}`,
          name: input.name,
          isSystem: false,
        } as never,
        select: { id: true },
      });
      await this.setPermissions(role.id, input.permissions);
      await this.audited('role.created', role.id, ip, { permissions: input.permissions });
      return this.get(role.id);
    });
  }

  async update(id: string, input: UpdateRoleRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const role = await this.find(id);
      if (role.key === 'owner') {
        throw new ForbiddenError('OWNER_ROLE_LOCKED', 'The Owner role cannot be changed.');
      }
      if (input.name !== undefined) await this.assertNameFree(input.name, id);
      const current = role.permissions.map((p) => p.permission);
      if (input.permissions) {
        const problems = permissionChangeProblems(current, input.permissions, this.held());
        if (problems.length) throw new ValidationFailedError(problems);
      }
      if (input.name !== undefined) {
        await this.tenantDb.db().role.update({ where: { id }, data: { name: input.name } });
      }
      if (input.permissions) await this.setPermissions(id, input.permissions);
      await this.audited('role.updated', id, ip, {
        ...(input.name !== undefined ? { fromName: role.name, toName: input.name } : {}),
        ...(input.permissions
          ? {
              added: input.permissions.filter((p) => !current.includes(p)),
              removed: current.filter((p) => !input.permissions!.includes(p)),
            }
          : {}),
      });
      return this.get(id);
    });
  }

  async remove(id: string, ip: string): Promise<null> {
    await this.tenantDb.withTenantTx(async () => {
      const role = await this.find(id);
      if (role.isSystem) {
        throw new ForbiddenError('SYSTEM_ROLE_LOCKED', 'System roles cannot be deleted.');
      }
      const pendingInvites = await this.prisma.authToken.count({
        where: {
          purpose: 'INVITE',
          tenantId: requireContext(this.cls, 'tenantId'),
          usedAt: null,
          expiresAt: { gt: new Date() },
          metadata: { path: ['roleId'], equals: id },
        },
      });
      if (role._count.memberships > 0 || pendingInvites > 0) {
        throw new DomainError(
          'ROLE_IN_USE',
          'Move its members and revoke its pending invitations first.',
          HttpStatus.CONFLICT,
        );
      }
      // Membership FKs are RESTRICT, so a member added concurrently makes this fail, not orphan.
      await this.tenantDb.db().role.deleteMany({ where: { id } });
      await this.audited('role.deleted', id, ip, { name: role.name });
    });
    return null;
  }

  private async find(id: string): Promise<RoleRow> {
    // Scoped: another atelier's role is not found (404).
    const role = await this.tenantDb.db().role.findFirst({ where: { id }, select: ROLE_SELECT });
    if (!role) throw new NotFoundError('Role not found.');
    return role;
  }

  private async get(id: string) {
    return toRole(await this.find(id));
  }

  private async setPermissions(roleId: string, permissions: string[]) {
    const db = this.tenantDb.db();
    await db.rolePermission.deleteMany({ where: { roleId } });
    await db.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId, permission })) as never,
    });
  }
}
