import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TenantDatabase } from '@tahi/database';
import type {
  CreateOptionGroupRequest,
  CreateOptionRequest,
  UpdateOptionGroupRequest,
  UpdateOptionRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { NotFoundError } from '../../core/http/domain-error.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';

export const GROUP_SELECT = {
  id: true,
  name: true,
  selection: true,
  required: true,
  archivedAt: true,
  options: {
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ] as Prisma.CatalogOptionOrderByWithRelationInput[],
    select: {
      id: true,
      name: true,
      priceDelta: true,
      currency: true,
      sortOrder: true,
      archivedAt: true,
    },
  },
} as const;

type GroupRow = Prisma.CatalogOptionGroupGetPayload<{ select: typeof GROUP_SELECT }>;

export const toGroup = (g: GroupRow) => ({
  id: g.id,
  name: g.name,
  selection: g.selection,
  required: g.required,
  archivedAt: g.archivedAt?.toISOString() ?? null,
  options: g.options.map((o) => ({
    id: o.id,
    name: o.name,
    priceDelta: { amount: o.priceDelta.toFixed(2), currency: o.currency },
    sortOrder: o.sortOrder,
    archivedAt: o.archivedAt?.toISOString() ?? null,
  })),
});

/** Shared option groups (e.g. Fabric) and their options (ADR-030). */
@Injectable()
export class OptionGroupsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly settings: TenantSettingsService,
  ) {}

  private audited(action: string, targetType: string, targetId: string, ip: string) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType,
      targetId,
      ip,
    });
  }

  async list() {
    const rows = await this.tenantDb.db().catalogOptionGroup.findMany({
      orderBy: { name: 'asc' },
      select: GROUP_SELECT,
    });
    return rows.map(toGroup);
  }

  async get(id: string) {
    return toGroup(await this.find(id));
  }

  /** Scoped: another atelier's group is not found (404). */
  async find(id: string): Promise<GroupRow> {
    const g = await this.tenantDb.db().catalogOptionGroup.findFirst({
      where: { id },
      select: GROUP_SELECT,
    });
    if (!g) throw new NotFoundError('Option group not found.');
    return g;
  }

  async create(input: CreateOptionGroupRequest, ip: string) {
    const id = await this.tenantDb.withTenantTx(async () => {
      const g = await this.tenantDb.db().catalogOptionGroup.create({
        data: input as never,
        select: { id: true },
      });
      await this.audited('option_group.created', 'option_group', g.id, ip);
      return g.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateOptionGroupRequest, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      await this.find(id);
      await this.tenantDb.db().catalogOptionGroup.update({ where: { id }, data: input });
      await this.audited('option_group.updated', 'option_group', id, ip);
    });
    return this.get(id);
  }

  /** Archived groups stay on existing items but cannot be attached again. */
  async setArchived(id: string, archived: boolean, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const g = await this.find(id);
      if ((g.archivedAt !== null) === archived) return;
      await this.tenantDb.db().catalogOptionGroup.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audited(
        archived ? 'option_group.archived' : 'option_group.restored',
        'option_group',
        id,
        ip,
      );
    });
    return this.get(id);
  }

  async addOption(groupId: string, input: CreateOptionRequest, ip: string) {
    const { currency } = await this.settings.settings();
    await this.tenantDb.withTenantTx(async () => {
      await this.find(groupId);
      const o = await this.tenantDb.db().catalogOption.create({
        data: { groupId, currency, ...input } as never,
        select: { id: true },
      });
      await this.audited('option.created', 'option', o.id, ip);
    });
    return this.get(groupId);
  }

  async updateOption(groupId: string, optionId: string, input: UpdateOptionRequest, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      await this.findOption(groupId, optionId);
      await this.tenantDb.db().catalogOption.update({ where: { id: optionId }, data: input });
      await this.audited('option.updated', 'option', optionId, ip);
    });
    return this.get(groupId);
  }

  async setOptionArchived(groupId: string, optionId: string, archived: boolean, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const o = await this.findOption(groupId, optionId);
      if ((o.archivedAt !== null) === archived) return;
      await this.tenantDb.db().catalogOption.update({
        where: { id: optionId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audited(archived ? 'option.archived' : 'option.restored', 'option', optionId, ip);
    });
    return this.get(groupId);
  }

  /** The option must belong to the group in the path. */
  private async findOption(groupId: string, optionId: string) {
    await this.find(groupId);
    const o = await this.tenantDb.db().catalogOption.findFirst({
      where: { id: optionId, groupId },
      select: { archivedAt: true },
    });
    if (!o) throw new NotFoundError('Option not found.');
    return o;
  }
}
