import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TenantDatabase } from '@tahi/database';
import {
  catalogItemProblems,
  type CatalogItemListQuery,
  type CreateCatalogCategoryRequest,
  type CreateCatalogItemRequest,
  type UpdateCatalogCategoryRequest,
  type UpdateCatalogItemRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { afterCursor, decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import { DomainError, NotFoundError, ValidationFailedError } from '../../core/http/domain-error.js';
import { Paginated } from '../../core/http/envelope.interceptor.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { GROUP_SELECT, OptionGroupsService, toGroup } from './option-groups.service.js';

const CATEGORY_SELECT = { id: true, name: true, sortOrder: true, archivedAt: true } as const;

const toCategory = (c: Prisma.CatalogCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>) => ({
  ...c,
  archivedAt: c.archivedAt?.toISOString() ?? null,
});

const ITEM_INCLUDE = { category: { select: { id: true, name: true } } } as const;
type ItemRow = Prisma.CatalogItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function toItem(i: ItemRow) {
  return {
    id: i.id,
    kind: i.kind,
    name: i.name,
    description: i.description,
    category: i.category,
    fulfilment: i.fulfilment,
    pricingMode: i.pricingMode,
    basePrice: i.basePrice ? { amount: i.basePrice.toFixed(2), currency: i.currency } : null,
    publicVisible: i.publicVisible,
    archivedAt: i.archivedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

/** Catalogue categories and items (ADR-030). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly settings: TenantSettingsService,
    private readonly groups: OptionGroupsService,
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

  // ----- Categories -------------------------------------------------------------------

  async listCategories() {
    const rows = await this.tenantDb.db().catalogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: CATEGORY_SELECT,
    });
    return rows.map(toCategory);
  }

  private async findCategory(id: string) {
    // Scoped: another atelier's category is not found (404).
    const c = await this.tenantDb.db().catalogCategory.findFirst({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!c) throw new NotFoundError('Catalogue category not found.');
    return c;
  }

  async createCategory(input: CreateCatalogCategoryRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const c = await this.tenantDb.db().catalogCategory.create({
        data: input as never,
        select: CATEGORY_SELECT,
      });
      await this.audited('catalog_category.created', 'catalog_category', c.id, ip);
      return toCategory(c);
    });
  }

  async updateCategory(id: string, input: UpdateCatalogCategoryRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.findCategory(id);
      const c = await this.tenantDb.db().catalogCategory.update({
        where: { id },
        data: input,
        select: CATEGORY_SELECT,
      });
      await this.audited('catalog_category.updated', 'catalog_category', id, ip);
      return toCategory(c);
    });
  }

  async setCategoryArchived(id: string, archived: boolean, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const current = await this.findCategory(id);
      if ((current.archivedAt !== null) === archived) return toCategory(current);
      const c = await this.tenantDb.db().catalogCategory.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: CATEGORY_SELECT,
      });
      await this.audited(
        archived ? 'catalog_category.archived' : 'catalog_category.restored',
        'catalog_category',
        id,
        ip,
      );
      return toCategory(c);
    });
  }

  /** New assignments need an active category; existing items keep an archived one. */
  private async assertAssignableCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const c = await this.findCategory(categoryId);
    if (c.archivedAt) throw new DomainError('CATEGORY_ARCHIVED', 'This category is archived.');
  }

  // ----- Items ------------------------------------------------------------------------

  async listItems(query: CatalogItemListQuery) {
    if (query.categoryId) await this.findCategory(query.categoryId);
    const where: Prisma.CatalogItemWhereInput = {
      ...(query.status === 'active' ? { archivedAt: null } : {}),
      ...(query.status === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const rows = await this.tenantDb.db().catalogItem.findMany({
      where: query.cursor ? { AND: [where, afterCursor(decodeCursor(query.cursor))] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: ITEM_INCLUDE,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return new Paginated(page.map(toItem), {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  }

  /** The item with its option groups (including archived options, for staff). */
  async getItem(id: string) {
    const item = await this.findItem(id);
    const links = await this.tenantDb.db().catalogItemOptionGroup.findMany({
      where: { itemId: id },
      orderBy: { sortOrder: 'asc' },
      select: { group: { select: GROUP_SELECT } },
    });
    return { ...toItem(item), optionGroups: links.map((l) => toGroup(l.group)) };
  }

  private async findItem(id: string): Promise<ItemRow> {
    // Scoped: another atelier's item is not found (404).
    const i = await this.tenantDb
      .db()
      .catalogItem.findFirst({ where: { id }, include: ITEM_INCLUDE });
    if (!i) throw new NotFoundError('Catalogue item not found.');
    return i;
  }

  async createItem(input: CreateCatalogItemRequest, ip: string) {
    const { currency } = await this.settings.settings();
    const id = await this.tenantDb.withTenantTx(async () => {
      await this.assertAssignableCategory(input.categoryId);
      const i = await this.tenantDb.db().catalogItem.create({
        data: { ...input, currency } as never,
        select: { id: true },
      });
      await this.audited('catalog_item.created', 'catalog_item', i.id, ip);
      return i.id;
    });
    return this.getItem(id);
  }

  async updateItem(id: string, input: UpdateCatalogItemRequest, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const current = await this.findItem(id);
      // Cross-field rules on the merged record (the DB CHECKs back them up).
      const merged = {
        kind: input.kind ?? current.kind,
        pricingMode: input.pricingMode ?? current.pricingMode,
        fulfilment: input.fulfilment === undefined ? current.fulfilment : input.fulfilment,
        basePrice:
          input.basePrice === undefined ? (current.basePrice?.toFixed(2) ?? null) : input.basePrice,
      };
      const problems = catalogItemProblems(merged);
      if (problems.length) throw new ValidationFailedError(problems);
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        await this.assertAssignableCategory(input.categoryId);
      }
      await this.tenantDb.db().catalogItem.update({ where: { id }, data: input });
      await this.audited('catalog_item.updated', 'catalog_item', id, ip);
    });
    return this.getItem(id);
  }

  async setItemArchived(id: string, archived: boolean, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const current = await this.findItem(id);
      if ((current.archivedAt !== null) === archived) return;
      await this.tenantDb.db().catalogItem.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audited(
        archived ? 'catalog_item.archived' : 'catalog_item.restored',
        'catalog_item',
        id,
        ip,
      );
    });
    return this.getItem(id);
  }

  /** Replaces the item's option groups in order. Newly attached groups must be active. */
  async setOptionGroups(id: string, groupIds: string[], ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      await this.findItem(id);
      const db = this.tenantDb.db();
      const current = new Set(
        (
          await db.catalogItemOptionGroup.findMany({
            where: { itemId: id },
            select: { groupId: true },
          })
        ).map((l) => l.groupId),
      );
      for (const groupId of groupIds) {
        const g = await this.groups.find(groupId);
        if (g.archivedAt && !current.has(groupId)) {
          throw new DomainError('OPTION_GROUP_ARCHIVED', `Option group "${g.name}" is archived.`);
        }
      }
      await db.catalogItemOptionGroup.deleteMany({ where: { itemId: id } });
      await db.catalogItemOptionGroup.createMany({
        data: groupIds.map((groupId, sortOrder) => ({ itemId: id, groupId, sortOrder })) as never,
      });
      await this.audited('catalog_item.option_groups_set', 'catalog_item', id, ip);
    });
    return this.getItem(id);
  }
}
