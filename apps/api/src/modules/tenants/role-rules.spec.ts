import type { Permission } from '@tahi/types';
import { describe, expect, it } from 'vitest';
import { permissionChangeProblems } from './role-rules.js';

const held = new Set<Permission>(['clients.read', 'clients.write', 'roles.manage']);

describe('permissionChangeProblems', () => {
  it('allows adding and removing permissions the caller holds', () => {
    expect(permissionChangeProblems(['clients.read'], ['clients.write'], held)).toEqual([]);
  });

  it('allows keeping permissions the caller does not hold', () => {
    expect(
      permissionChangeProblems(['payments.refund'], ['payments.refund', 'clients.read'], held),
    ).toEqual([]);
  });

  it('rejects granting a permission the caller lacks', () => {
    expect(permissionChangeProblems([], ['payments.refund'], held).map((p) => p.message)).toEqual([
      'You cannot grant or remove payments.refund, which you do not hold',
    ]);
  });

  it('rejects removing a permission the caller lacks', () => {
    expect(permissionChangeProblems(['payments.refund'], [], held)).toHaveLength(1);
  });

  it('rejects unknown and owner-only permissions even for an all-powerful caller', () => {
    const all = new Set<Permission>(['tenant.billing']);
    expect(
      permissionChangeProblems([], ['tenant.billing', 'nope.read'], all).map((p) => p.path),
    ).toEqual([
      ['permissions', 0],
      ['permissions', 1],
    ]);
  });
});
