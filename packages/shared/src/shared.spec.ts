import { describe, expect, it } from 'vitest';
import { GARMENT_STAGES, isValidTenantSlug, paginationQuerySchema } from './index.js';

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
