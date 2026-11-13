import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type TenantDatabase } from '@tahi/database';
import type {
  ConvertQuotationRequest,
  CreateOrderRequest,
  OrderListQuery,
  OrderProgressStatus,
  UpdateOrderRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { afterCursor, decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import { DomainError, NotFoundError } from '../../core/http/domain-error.js';
import { Paginated } from '../../core/http/envelope.interceptor.js';
import { CounterService, yearIn } from '../../core/numbering/counter.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { MeasurementsService } from '../measurements/measurements.service.js';
import {
  LinePricingService,
  type BuiltLines,
  type OptionSnapshot,
} from '../quotations/line-pricing.service.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';

type Status = Prisma.OrderGetPayload<object>['status'];
const FLOW: Status[] = ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'RELEASED'];
const OPEN: Status[] = ['CONFIRMED', 'IN_PRODUCTION', 'READY'];

const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true } },
  items: { orderBy: { sortOrder: 'asc' } },
  history: {
    orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    include: { changedBy: { select: { id: true, user: { select: { name: true } } } } },
  },
} as const satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

function toOrder(o: Row) {
  const m = (d: Prisma.Decimal) => ({ amount: d.toFixed(2), currency: o.currency });
  return {
    id: o.id,
    number: o.number,
    quotationId: o.quotationId,
    client: {
      id: o.client.id,
      name: [o.client.firstName, o.client.lastName].filter(Boolean).join(' '),
    },
    status: o.status,
    promisedDate: o.promisedDate ? isoDate(o.promisedDate) : null,
    subtotal: m(o.subtotal),
    discount: m(o.discount),
    tax: m(o.tax),
    total: m(o.total),
    taxRate: o.taxRate.toFixed(2),
    pricesIncludeTax: o.pricesIncludeTax,
    notes: o.notes,
    cancelReason: o.cancelReason,
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: o.items.map((i) => ({
      id: i.id,
      catalogItemId: i.catalogItemId,
      name: i.name,
      description: i.description,
      unitPrice: m(i.unitPrice),
      quantity: i.quantity,
      options: (i.options as unknown as OptionSnapshot[]).map((x) => ({
        ...x,
        priceDelta: { amount: x.priceDelta, currency: o.currency },
      })),
      lineTotal: m(i.lineTotal),
      measurementRecordId: i.measurementRecordId,
      measurementSnapshot: i.measurementSnapshot as never,
    })),
    history: o.history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      changedBy: { membershipId: h.changedBy.id, name: h.changedBy.user.name },
      changedAt: h.changedAt.toISOString(),
    })),
  };
}

const conflict = (code: string, message: string) =>
  new DomainError(code, message, HttpStatus.CONFLICT);
const invalidStatus = (action: string, status: Status) =>
  conflict('INVALID_ORDER_STATUS', `Cannot ${action} an order that is ${status}.`);

/** A line ready to insert: priced, snapshotted, with its measurements frozen. */
interface ItemRow {
  sortOrder: number;
  catalogItemId: string | null;
  name: string;
  description: string | null;
  unitPrice: Prisma.Decimal;
  quantity: number;
  options: unknown;
  lineTotal: Prisma.Decimal;
  measurementRecordId: string | null;
}

/** Orders: conversion, direct sales, edits while confirmed, status flow, cancel (ADR-034). */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly settings: TenantSettingsService,
    private readonly clients: ClientsService,
    private readonly measurements: MeasurementsService,
    private readonly pricing: LinePricingService,
  ) {}

  private audited(action: string, id: string, ip: string, metadata?: Prisma.InputJsonObject) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType: 'order',
      targetId: id,
      ip,
      ...(metadata ? { metadata } : {}),
    });
  }

  private async find(id: string): Promise<Row> {
    // Scoped: another atelier's order is not found (404).
    const o = await this.tenantDb.db().order.findFirst({ where: { id }, include: INCLUDE });
    if (!o) throw new NotFoundError('Order not found.');
    return o;
  }

  async get(id: string) {
    return toOrder(await this.find(id));
  }

  async list(query: OrderListQuery) {
    if (query.clientId) await this.clients.get(query.clientId);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    };
    const rows = await this.tenantDb.db().order.findMany({
      where: query.cursor ? { AND: [where, afterCursor(decodeCursor(query.cursor))] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { client: INCLUDE.client },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return new Paginated(
      page.map((o) => toOrder({ ...o, items: [], history: [] })),
      { hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null },
    );
  }

  /** A frozen copy of the measurements, so the order keeps them when newer ones are taken. */
  private async snapshot(recordId: string | null) {
    if (!recordId) return Prisma.DbNull;
    const r = await this.measurements.record(recordId);
    return {
      recordId: r.id,
      category: r.category.name,
      unit: r.unit,
      takenAt: r.takenAt,
      measuredFor: r.measuredFor,
      values: r.values,
    };
  }

  private async writeItems(orderId: string, items: ItemRow[]) {
    const data = [];
    for (const i of items) {
      data.push({
        ...i,
        orderId,
        options: i.options as Prisma.InputJsonValue,
        measurementSnapshot: await this.snapshot(i.measurementRecordId),
      });
    }
    await this.tenantDb.db().orderItem.createMany({ data: data as never });
  }

  private history(orderId: string, fromStatus: Status | null, toStatus: Status) {
    return this.tenantDb.db().orderStatusHistory.create({
      data: {
        orderId,
        fromStatus,
        toStatus,
        changedByMembershipId: requireContext(this.cls, 'membershipId'),
      } as never,
    });
  }

  private async insert(
    header: Omit<Prisma.OrderUncheckedCreateInput, 'tenantId' | 'number' | 'createdByMembershipId'>,
    items: ItemRow[],
  ) {
    const { timezone } = await this.settings.settings();
    const order = await this.tenantDb.db().order.create({
      data: {
        ...header,
        number: await this.counters.next('ORD', yearIn(timezone)),
        createdByMembershipId: requireContext(this.cls, 'membershipId'),
      } as never,
    });
    await this.writeItems(order.id, items);
    await this.history(order.id, null, 'CONFIRMED');
    return order.id;
  }

  /** A walk-in sale: lines priced like a quotation's. */
  async create(input: CreateOrderRequest, ip: string) {
    const client = await this.clients.get(input.clientId);
    const built: BuiltLines = await this.pricing.build(client.id, input.items, input.discount);
    const id = await this.tenantDb.withTenantTx(async () => {
      const id = await this.insert(
        {
          clientId: client.id,
          currency: built.currency,
          ...built.header,
          promisedDate: input.promisedDate ? asDate(input.promisedDate) : null,
          notes: input.notes ?? null,
        },
        built.items,
      );
      await this.audited('order.created', id, ip);
      return id;
    });
    return this.get(id);
  }

  /**
   * ACCEPTED quotation → order in one transaction (DATABASE_DESIGN.md §3.3). The quotation row
   * is locked first, so a concurrent repeat waits, then finds it CONVERTED and returns the
   * same order. Prices are copied as quoted; measurements are frozen now.
   */
  async convert(input: ConvertQuotationRequest, ip: string) {
    const id = await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM quotation WHERE id = ${input.quotationId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Quotation not found.');
      const q = await db.quotation.findFirstOrThrow({
        where: { id: input.quotationId },
        include: { items: { orderBy: { sortOrder: 'asc' } }, order: { select: { id: true } } },
      });
      if (q.order) return q.order.id; // already converted: same answer again
      if (q.status !== 'ACCEPTED') {
        throw conflict(
          'QUOTATION_NOT_ACCEPTED',
          `Only an accepted quotation can become an order; this one is ${q.status}.`,
        );
      }
      await this.clients.get(q.clientId); // an erased client's quotation can't be converted
      const id = await this.insert(
        {
          clientId: q.clientId,
          quotationId: q.id,
          currency: q.currency,
          subtotal: q.subtotal,
          discount: q.discount,
          tax: q.tax,
          total: q.total,
          taxRate: q.taxRate,
          pricesIncludeTax: q.pricesIncludeTax,
          promisedDate: input.promisedDate ? asDate(input.promisedDate) : null,
          notes: q.notes,
        },
        q.items.map((i) => ({
          sortOrder: i.sortOrder,
          catalogItemId: i.catalogItemId,
          name: i.name,
          description: i.description,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          options: i.options,
          lineTotal: i.lineTotal,
          measurementRecordId: i.measurementRecordId,
        })),
      );
      await db.quotation.update({
        where: { id: q.id },
        data: { status: 'CONVERTED', version: { increment: 1 } },
      });
      await this.audited('order.converted', id, ip, { quotationId: q.id });
      return id;
    });
    return this.get(id);
  }

  /** Header at any open status; lines (and discount) only while CONFIRMED. */
  async update(id: string, input: UpdateOrderRequest, ip: string) {
    const current = await this.find(id);
    if (!OPEN.includes(current.status)) throw invalidStatus('edit', current.status);
    if (input.items && current.status !== 'CONFIRMED') {
      throw invalidStatus('change the items of', current.status);
    }
    await this.clients.get(current.clientId); // an erased client's orders are frozen (404)
    const built = input.items
      ? await this.pricing.build(current.clientId, input.items, input.discount)
      : null;
    await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      const { count } = await db.order.updateMany({
        where: {
          id,
          version: input.version,
          status: built ? 'CONFIRMED' : { in: OPEN },
        },
        data: {
          ...(input.promisedDate !== undefined
            ? { promisedDate: input.promisedDate ? asDate(input.promisedDate) : null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(built ? built.header : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) {
        throw conflict('VERSION_CONFLICT', 'This order was changed by someone else. Reload it.');
      }
      if (built) {
        await db.orderItem.deleteMany({ where: { orderId: id } });
        await this.writeItems(id, built.items);
      }
      await this.audited('order.updated', id, ip);
    });
    return this.get(id);
  }

  /** Forward only (CONFIRMED → IN_PRODUCTION → READY → RELEASED); steps may be skipped. */
  async progress(id: string, to: OrderProgressStatus, ip: string) {
    const current = await this.find(id);
    if (!OPEN.includes(current.status) || FLOW.indexOf(to) <= FLOW.indexOf(current.status)) {
      throw invalidStatus(`move to ${to}`, current.status);
    }
    await this.tenantDb.withTenantTx(async () => {
      const { count } = await this.tenantDb.db().order.updateMany({
        where: { id, status: current.status },
        data: { status: to, version: { increment: 1 } },
      });
      if (count === 0) throw invalidStatus(`move to ${to}`, (await this.find(id)).status);
      await this.history(id, current.status, to);
      await this.audited(`order.${to.toLowerCase()}`, id, ip);
    });
    return this.get(id);
  }

  /** Before release only. Refunds stay manual (Phase 4 step 5). */
  async cancel(id: string, reason: string, ip: string) {
    const current = await this.find(id);
    if (!OPEN.includes(current.status)) throw invalidStatus('cancel', current.status);
    await this.tenantDb.withTenantTx(async () => {
      const { count } = await this.tenantDb.db().order.updateMany({
        where: { id, status: current.status },
        data: { status: 'CANCELLED', cancelReason: reason, version: { increment: 1 } },
      });
      if (count === 0) throw invalidStatus('cancel', (await this.find(id)).status);
      await this.history(id, current.status, 'CANCELLED');
      await this.audited('order.cancelled', id, ip);
    });
    return this.get(id);
  }

  // ----- Data-subject rights (ADR-032); called by PrivacyService inside its transaction ---

  async exportForClient(clientId: string) {
    const rows = await this.tenantDb.db().order.findMany({
      where: { clientId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: INCLUDE,
    });
    return rows.map(toOrder);
  }

  /**
   * Refuses while the client has open orders. Otherwise clears free text, measurement links
   * and measurement snapshots; prices and lines stay (BIR retention, ADR-032).
   */
  async eraseForClient(clientId: string): Promise<void> {
    const db = this.tenantDb.db();
    const open = await db.order.count({ where: { clientId, status: { in: OPEN } } });
    if (open > 0) {
      throw conflict(
        'CLIENT_HAS_OPEN_ORDERS',
        'Release or cancel this client’s open orders before erasing their data.',
      );
    }
    await db.order.updateMany({ where: { clientId }, data: { notes: null } });
    await db.order.updateMany({
      where: { clientId, status: 'CANCELLED' },
      data: { cancelReason: 'Erased' },
    });
    await db.orderItem.updateMany({
      where: { order: { clientId } },
      data: { measurementRecordId: null, measurementSnapshot: Prisma.DbNull },
    });
  }
}
