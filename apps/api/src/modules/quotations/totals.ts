import { Prisma } from '@tahi/database';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const money = (d: Decimal) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

export interface LineInput {
  unitPrice: Decimal;
  quantity: number;
  priceDeltas: Decimal[];
}

export interface Totals {
  lineTotals: Decimal[];
  subtotal: Decimal;
  discount: Decimal;
  tax: Decimal;
  total: Decimal;
}

/**
 * Quotation totals (ADR-033), exact decimals throughout:
 * - line = (unit price + Σ option deltas) × quantity, floored at 0 (deltas may be negative);
 * - subtotal = Σ lines; discount ≤ subtotal (the caller rejects more);
 * - prices include tax: tax = net × rate ÷ (100 + rate), total = net;
 *   otherwise tax = net × rate ÷ 100, total = net + tax. Tax rounds half up to centavos.
 */
export function computeTotals(
  lines: LineInput[],
  discount: Decimal,
  taxRate: Decimal,
  pricesIncludeTax: boolean,
): Totals {
  const lineTotals = lines.map((l) =>
    D.max(0, l.priceDeltas.reduce((a, d) => a.plus(d), l.unitPrice).times(l.quantity)),
  );
  const subtotal = lineTotals.reduce((a, l) => a.plus(l), new D(0));
  const net = subtotal.minus(discount);
  const tax = pricesIncludeTax
    ? money(net.times(taxRate).dividedBy(taxRate.plus(100)))
    : money(net.times(taxRate).dividedBy(100));
  return {
    lineTotals: lineTotals.map(money),
    subtotal: money(subtotal),
    discount: money(discount),
    tax,
    total: money(pricesIncludeTax ? net : net.plus(tax)),
  };
}
