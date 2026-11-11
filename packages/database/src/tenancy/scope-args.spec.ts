import { describe, expect, it } from 'vitest';
import { TenantScopeViolationError } from './errors.js';
import { scopeArgs } from './scope-args.js';

const T = '01960000-0000-7000-8000-000000000001';
const OTHER = '01960000-0000-7000-8000-000000000002';

describe('scopeArgs', () => {
  it.each(['findMany', 'findFirst', 'count', 'deleteMany', 'aggregate', 'groupBy'])(
    'adds tenantId to where for %s',
    (op) => {
      expect(scopeArgs(op, { where: { name: 'x' } }, T).where).toEqual({ name: 'x', tenantId: T });
    },
  );

  it('adds a where clause when none was given', () => {
    expect(scopeArgs('findMany', undefined, T)).toEqual({ where: { tenantId: T } });
  });

  it('keeps unique selectors at the top level (extended where unique)', () => {
    expect(scopeArgs('findUnique', { where: { id: 'a' } }, T).where).toEqual({
      id: 'a',
      tenantId: T,
    });
  });

  it('rejects a foreign tenantId in where, including filter objects', () => {
    expect(() => scopeArgs('findMany', { where: { tenantId: OTHER } }, T)).toThrow(
      TenantScopeViolationError,
    );
    expect(() => scopeArgs('findMany', { where: { tenantId: { not: T } } }, T)).toThrow(
      TenantScopeViolationError,
    );
  });

  it('allows the context tenantId to be repeated', () => {
    expect(scopeArgs('findMany', { where: { tenantId: T } }, T).where).toEqual({ tenantId: T });
  });

  it('checks compound unique selectors', () => {
    expect(() =>
      scopeArgs('findUnique', { where: { tenantId_id: { tenantId: OTHER, id: 'a' } } }, T),
    ).toThrow(TenantScopeViolationError);
  });

  it('stamps tenantId on create and createMany', () => {
    expect(scopeArgs('create', { data: { name: 'r' } }, T).data).toEqual({
      name: 'r',
      tenantId: T,
    });
    expect(scopeArgs('createMany', { data: [{ a: 1 }, { a: 2 }] }, T).data).toEqual([
      { a: 1, tenantId: T },
      { a: 2, tenantId: T },
    ]);
  });

  it('rejects creates for another tenant or via the tenant relation', () => {
    expect(() => scopeArgs('create', { data: { tenantId: OTHER } }, T)).toThrow(
      TenantScopeViolationError,
    );
    expect(() => scopeArgs('create', { data: { tenant: { connect: { id: T } } } }, T)).toThrow(
      TenantScopeViolationError,
    );
  });

  it('rejects moving a row to another tenant on update and upsert', () => {
    expect(() => scopeArgs('update', { where: { id: 'a' }, data: { tenantId: OTHER } }, T)).toThrow(
      TenantScopeViolationError,
    );
    expect(() =>
      scopeArgs('upsert', { where: { id: 'a' }, create: {}, update: { tenantId: OTHER } }, T),
    ).toThrow(TenantScopeViolationError);
  });

  it('stamps upsert create and scopes its where', () => {
    const a = scopeArgs('upsert', { where: { id: 'a' }, create: { name: 'n' }, update: {} }, T);
    expect(a.where).toEqual({ id: 'a', tenantId: T });
    expect(a.create).toEqual({ name: 'n', tenantId: T });
  });

  it('rejects unknown operations (fail closed on Prisma upgrades)', () => {
    expect(() => scopeArgs('findRaw', {}, T)).toThrow(TenantScopeViolationError);
  });
});
