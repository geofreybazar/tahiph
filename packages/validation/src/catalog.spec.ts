import { describe, expect, it } from 'vitest';
import {
  createCatalogItemRequestSchema,
  createOptionRequestSchema,
  setItemOptionGroupsRequestSchema,
} from './catalog.js';

const id = '0190c0de-0000-7000-8000-000000000001';

describe('catalog item requests', () => {
  it('requires a base price for fixed pricing, not for quotes', () => {
    const base = { kind: 'PRODUCT', name: 'Barong', fulfilment: 'MADE_TO_MEASURE' } as const;
    expect(
      createCatalogItemRequestSchema.safeParse({ ...base, pricingMode: 'FIXED' }).success,
    ).toBe(false);
    expect(
      createCatalogItemRequestSchema.safeParse({
        ...base,
        pricingMode: 'FIXED',
        basePrice: '8500.00',
      }).success,
    ).toBe(true);
    expect(
      createCatalogItemRequestSchema.safeParse({ ...base, pricingMode: 'QUOTE' }).success,
    ).toBe(true);
  });

  it('rejects negative or float prices and fulfilment on services', () => {
    const svc = { kind: 'SERVICE', name: 'Alteration', pricingMode: 'FIXED' } as const;
    expect(createCatalogItemRequestSchema.safeParse({ ...svc, basePrice: '-1.00' }).success).toBe(
      false,
    );
    expect(createCatalogItemRequestSchema.safeParse({ ...svc, basePrice: 350 }).success).toBe(
      false,
    );
    expect(
      createCatalogItemRequestSchema.safeParse({
        ...svc,
        basePrice: '350',
        fulfilment: 'READY_TO_WEAR',
      }).success,
    ).toBe(false);
  });
});

describe('options', () => {
  it('allows negative price changes', () => {
    expect(createOptionRequestSchema.parse({ name: 'Own fabric', priceDelta: '-2000.00' })).toEqual(
      {
        name: 'Own fabric',
        priceDelta: '-2000.00',
      },
    );
  });

  it('rejects duplicate groups on an item', () => {
    expect(setItemOptionGroupsRequestSchema.safeParse({ groupIds: [id, id] }).success).toBe(false);
  });
});
