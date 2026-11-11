import { describe, expect, it } from 'vitest';
import { currencySchema, moneyAmountSchema, paginationQuerySchema } from './common.js';

describe('moneyAmountSchema', () => {
  it.each(['0', '15000', '15000.5', '15000.50', '-120.00', '9999999999.99'])('accepts %s', (v) => {
    expect(moneyAmountSchema.safeParse(v).success).toBe(true);
  });

  it.each(['', '1.234', '1e5', '12,000.00', '99999999999', ' 10', 'abc'])('rejects %j', (v) => {
    expect(moneyAmountSchema.safeParse(v).success).toBe(false);
  });

  it('rejects JS numbers', () => {
    expect(moneyAmountSchema.safeParse(100).success).toBe(false);
  });
});

describe('currencySchema', () => {
  it('accepts upper-case ISO codes only', () => {
    expect(currencySchema.safeParse('PHP').success).toBe(true);
    expect(currencySchema.safeParse('php').success).toBe(false);
    expect(currencySchema.safeParse('PESO').success).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('defaults limit to 25 and coerces query strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(paginationQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
  });

  it('caps limit at 100', () => {
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
