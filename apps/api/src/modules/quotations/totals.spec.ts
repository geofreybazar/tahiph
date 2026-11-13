import { Prisma } from '@tahi/database';
import { describe, expect, it } from 'vitest';
import { computeTotals } from './totals.js';

const d = (v: string) => new Prisma.Decimal(v);
const str = (t: ReturnType<typeof computeTotals>) => ({
  lines: t.lineTotals.map((l) => l.toFixed(2)),
  subtotal: t.subtotal.toFixed(2),
  discount: t.discount.toFixed(2),
  tax: t.tax.toFixed(2),
  total: t.total.toFixed(2),
});

describe('computeTotals', () => {
  const lines = [
    { unitPrice: d('18500.00'), quantity: 1, priceDeltas: [d('2500.00'), d('-500.00')] },
    { unitPrice: d('350.50'), quantity: 3, priceDeltas: [] },
  ];

  it('includes 12% VAT in the price by default (Philippine pricing)', () => {
    expect(str(computeTotals(lines, d('1000'), d('12'), true))).toEqual({
      lines: ['20500.00', '1051.50'],
      subtotal: '21551.50',
      discount: '1000.00',
      // 20551.50 × 12 / 112 = 2201.9464… → 2201.95
      tax: '2201.95',
      total: '20551.50',
    });
  });

  it('adds tax on top when prices exclude it', () => {
    const t = str(computeTotals(lines, d('0'), d('12'), false));
    // 21551.50 × 0.12 = 2586.18
    expect(t).toMatchObject({ tax: '2586.18', total: '24137.68' });
  });

  it('charges no tax at 0% (non-VAT ateliers)', () => {
    expect(str(computeTotals(lines, d('0'), d('0'), true))).toMatchObject({
      tax: '0.00',
      total: '21551.50',
    });
  });

  it('floors a line at zero when negative options exceed the price', () => {
    const t = computeTotals(
      [{ unitPrice: d('100'), quantity: 2, priceDeltas: [d('-150')] }],
      d('0'),
      d('12'),
      true,
    );
    expect(str(t)).toMatchObject({ lines: ['0.00'], subtotal: '0.00', total: '0.00' });
  });

  it('rounds tax half up to the centavo, with no float drift', () => {
    // 0.10 × 3 is exactly 0.30 (0.1 * 3 is 0.30000000000000004 in floats).
    const t = computeTotals(
      [{ unitPrice: d('0.10'), quantity: 3, priceDeltas: [] }],
      d('0'),
      d('5'),
      false,
    );
    expect(str(t)).toMatchObject({ subtotal: '0.30', tax: '0.02', total: '0.32' }); // 0.015 → 0.02
  });
});
