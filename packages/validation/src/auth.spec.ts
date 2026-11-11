import { describe, expect, it } from 'vitest';
import { loginRequestSchema, registerRequestSchema } from './auth.js';
import { createAtelierRequestSchema, slugSchema } from './tenants.js';

describe('auth contracts', () => {
  it('normalizes email and enforces password length', () => {
    const r = registerRequestSchema.parse({
      email: ' Maria@Example.PH ',
      password: 'x'.repeat(10),
      name: 'Maria',
    });
    expect(r.email).toBe('maria@example.ph');
    expect(
      registerRequestSchema.safeParse({ email: 'a@b.ph', password: 'short', name: 'M' }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ email: 'a@b.ph', password: 'x'.repeat(129), name: 'M' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown keys on auth requests', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.ph', password: 'p', tenantId: 'x' }).success,
    ).toBe(false);
  });
});

describe('tenant contracts', () => {
  it.each(['maria-couture', 'abc', 'atelier2026'])('accepts slug %s', (s) => {
    expect(slugSchema.parse(s)).toBe(s);
  });

  it.each(['ab', '-maria', 'maria-', 'ma--ria', 'Maria Couture', 'admin', 'api', 'x'.repeat(41)])(
    'rejects slug %s',
    (s) => {
      expect(slugSchema.safeParse(s).success).toBe(false);
    },
  );

  it('lower-cases slugs', () => {
    expect(
      createAtelierRequestSchema.parse({ businessName: 'Maria Couture', slug: 'Maria-Couture' })
        .slug,
    ).toBe('maria-couture');
  });
});
