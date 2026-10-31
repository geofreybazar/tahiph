import { describe, expect, it } from 'vitest';
import {
  formatCentavos,
  GARMENT_STAGES,
  isValidTenantSlug,
  paginationQuerySchema,
  pesosToCentavos,
} from './index.js';

describe('isValidTenantSlug', () => {
  it.each(['demo', 'maria-clara', 'atelier9'])('accepts %s', (slug) => {
    expect(isValidTenantSlug(slug)).toBe(true);
  });

  it.each(['www', 'api', 'Demo', '-demo', 'demo-', 'a--b', 'a.b', '', 'x'.repeat(64)])(
    'rejects %j',
    (slug) => {
      expect(isValidTenantSlug(slug)).toBe(false);
    },
  );
});

describe('paginationQuerySchema', () => {
  it('coerces query strings and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });
  });

  it.each([{ limit: '101' }, { page: '0' }, { page: 'abc' }])('rejects %j', (query) => {
    expect(paginationQuerySchema.safeParse(query).success).toBe(false);
  });
});

it('keeps the nine production stages in workflow order', () => {
  expect(GARMENT_STAGES).toHaveLength(9);
  expect(GARMENT_STAGES[0]).toBe('design');
  expect(GARMENT_STAGES[8]).toBe('released');
});

describe('money', () => {
  it.each([
    ['1500', 150000],
    ['1,500.50', 150050],
    ['₱ 1,234,567.8', 123456780],
    ['0.01', 1],
    ['19.99', 1999],
    ['0', 0],
    ['21474836.47', 2147483647],
  ])('parses %s without float errors', (input, centavos) => {
    expect(pesosToCentavos(input)).toBe(centavos);
  });

  it.each(['', 'abc', '1.234', '-5', '1,50', '12,3456', '1e5', '21474836.48', '.5'])(
    'refuses %j',
    (input) => {
      expect(pesosToCentavos(input)).toBeNull();
    },
  );

  it('formats centavos', () => {
    expect(formatCentavos(150050)).toBe('₱1,500.50');
    expect(formatCentavos(5)).toBe('₱0.05');
    expect(formatCentavos(-100)).toBe('-₱1.00');
  });
});
