import { describe, expect, it } from 'vitest';
import {
  PLATFORM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_PERMISSIONS,
  isTenantPermission,
} from './permissions.js';

const role = (key: string) => {
  const r = SYSTEM_ROLES.find((x) => x.key === key);
  if (!r) throw new Error(key);
  return new Set(r.permissions);
};

describe('permission catalogue', () => {
  it('has no duplicates', () => {
    expect(new Set(TENANT_PERMISSIONS).size).toBe(TENANT_PERMISSIONS.length);
  });

  it('system roles only reference catalogue permissions, without duplicates', () => {
    for (const r of SYSTEM_ROLES) {
      expect(r.permissions.every(isTenantPermission)).toBe(true);
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
    }
  });

  it('owner has every permission; owner-only permissions stay with the owner', () => {
    expect(role('owner').size).toBe(TENANT_PERMISSIONS.length);
    for (const key of ['admin', 'designer', 'tailor', 'staff']) {
      for (const p of ['tenant.billing', 'tenant.merchant_account', 'tenant.transfer_ownership']) {
        expect(role(key).has(p as never)).toBe(false);
      }
    }
  });

  it('matches the documented matrix for sensitive permissions', () => {
    expect(role('admin').has('payments.refund')).toBe(true);
    expect(role('designer').has('payments.refund')).toBe(false);
    expect(role('designer').has('quotations.approve')).toBe(false);
    expect(role('designer').has('staff.manage')).toBe(false);
    expect(role('tailor').has('production.read')).toBe(false);
    expect(role('tailor').has('production.read_assigned')).toBe(true);
    expect(role('tailor').has('payments.read')).toBe(false);
    expect(role('staff').has('reports.financial')).toBe(false);
    for (const key of ['admin', 'designer', 'tailor', 'staff']) {
      expect(role(key).has('clients.privacy')).toBe(false);
    }
  });

  it('only super admins manage platform admins', () => {
    expect(PLATFORM_ROLE_PERMISSIONS.SUPER_ADMIN).toContain('platform.admins.manage');
    expect(PLATFORM_ROLE_PERMISSIONS.PLATFORM_ADMIN).not.toContain('platform.admins.manage');
  });
});
