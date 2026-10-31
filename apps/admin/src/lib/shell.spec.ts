import { describe, expect, it } from 'vitest';
import { navigationFor } from './navigation';
import { chooseTenant, type Membership } from './tenants';

const tenant = (id: string): Membership => ({
  id,
  name: id,
  slug: id,
  status: 'active',
  role: 'staff',
});

describe('chooseTenant', () => {
  const memberships = [tenant('a'), tenant('b')];

  it('uses the remembered tenant when still a member', () => {
    expect(chooseTenant(memberships, 'b')?.id).toBe('b');
  });

  it('ignores a remembered tenant the user no longer belongs to', () => {
    expect(chooseTenant(memberships, 'removed')?.id).toBe('a');
  });

  it('falls back to the first tenant, or nothing', () => {
    expect(chooseTenant(memberships, null)?.id).toBe('a');
    expect(chooseTenant([], 'a')).toBeNull();
  });
});

describe('navigationFor', () => {
  it('hides financial items from staff', () => {
    expect(navigationFor('staff').map((item) => item.label)).toEqual(['Dashboard']);
  });

  it.each(['owner', 'admin'] as const)('shows financial items to %s', (role) => {
    expect(navigationFor(role).map((item) => item.label)).toContain('Reports');
  });
});
