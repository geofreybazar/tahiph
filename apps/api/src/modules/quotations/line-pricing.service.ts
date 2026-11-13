import { Injectable } from '@nestjs/common';
import { Prisma } from '@tahi/database';
import type { QuotationItemInput } from '@tahi/validation';
import { NotFoundError, ValidationFailedError } from '../../core/http/domain-error.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { MeasurementsService } from '../measurements/measurements.service.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { computeTotals } from './totals.js';

const D = Prisma.Decimal;

export interface OptionSnapshot {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: string;
}

export type BuiltLines = Awaited<ReturnType<LinePricingService['build']>>;

/**
 * Priced, snapshotted lines for quotations and direct orders (ADR-033, ADR-034): the same
 * catalogue, option and measurement rules and the same totals for both.
 */
@Injectable()
export class LinePricingService {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly catalog: CatalogService,
    private readonly measurements: MeasurementsService,
  ) {}

  /**
   * Resolves item inputs against the catalogue and the client's measurements, then prices
   * everything with the current tax settings. Ids that aren't the atelier's are 404.
   */
  async build(clientId: string, inputs: QuotationItemInput[], discountInput: string | undefined) {
    const s = await this.settings.settings();
    const items = [];
    for (const [index, input] of inputs.entries()) {
      items.push(await this.buildItem(clientId, input, index));
    }
    const discount = new D(discountInput ?? '0');
    const t = computeTotals(
      items.map((i) => ({
        unitPrice: i.unitPrice,
        quantity: i.quantity,
        priceDeltas: i.options.map((o) => new D(o.priceDelta)),
      })),
      discount,
      new D(s.taxRate),
      s.pricesIncludeTax,
    );
    if (discount.greaterThan(t.subtotal)) {
      throw new ValidationFailedError([
        { path: ['discount'], message: 'Must not exceed the subtotal' },
      ]);
    }
    return {
      currency: s.currency,
      header: {
        subtotal: t.subtotal,
        discount: t.discount,
        tax: t.tax,
        total: t.total,
        taxRate: new D(s.taxRate),
        pricesIncludeTax: s.pricesIncludeTax,
      },
      items: items.map((i, n) => ({ ...i, lineTotal: t.lineTotals[n]! })),
    };
  }

  private async buildItem(clientId: string, input: QuotationItemInput, index: number) {
    const fail = (field: string, message: string) =>
      new ValidationFailedError([{ path: ['items', index, field], message }]);
    if (input.measurementRecordId) {
      const record = await this.measurements.record(input.measurementRecordId);
      if (record.clientId !== clientId) {
        throw fail('measurementRecordId', 'These measurements belong to another client.');
      }
    }
    const base = {
      sortOrder: index,
      quantity: input.quantity,
      measurementRecordId: input.measurementRecordId ?? null,
    };
    if (!input.catalogItemId) {
      return {
        ...base,
        catalogItemId: null,
        name: input.name!,
        description: input.description ?? null,
        unitPrice: new D(input.unitPrice!),
        options: [] as OptionSnapshot[],
      };
    }
    const item = await this.catalog.getItem(input.catalogItemId);
    if (item.archivedAt) throw fail('catalogItemId', 'This catalogue item is archived.');
    const price = input.unitPrice ?? item.basePrice?.amount;
    if (price === undefined) {
      throw fail('unitPrice', 'Quotation-priced items need a unit price.');
    }
    const chosen = new Set(input.optionIds);
    const options: OptionSnapshot[] = [];
    for (const group of item.optionGroups) {
      const picked = group.options.filter((o) => chosen.has(o.id));
      for (const o of picked) {
        if (o.archivedAt) throw fail('optionIds', `“${o.name}” is archived.`);
        chosen.delete(o.id);
        options.push({
          groupId: group.id,
          groupName: group.name,
          optionId: o.id,
          optionName: o.name,
          priceDelta: o.priceDelta.amount,
        });
      }
      if (group.selection === 'SINGLE' && picked.length > 1) {
        throw fail('optionIds', `Choose one option for “${group.name}”.`);
      }
      if (group.required && !group.archivedAt && picked.length === 0) {
        throw fail('optionIds', `“${group.name}” needs a choice.`);
      }
    }
    // Ids not on this item: another atelier's, or not offered for it. Either way, not found.
    if (chosen.size > 0) throw new NotFoundError('Option not found on this catalogue item.');
    return {
      ...base,
      catalogItemId: item.id,
      name: input.name ?? item.name,
      description: input.description !== undefined ? input.description : item.description,
      unitPrice: new D(price),
      options,
    };
  }
}
