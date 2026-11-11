import { describe, expect, it } from 'vitest';
import { createRoleRequestSchema, updateRoleRequestSchema } from './roles.js';

describe('role requests', () => {
  it('dedupes and sorts permissions', () => {
    expect(
      createRoleRequestSchema.parse({ name: ' Cutter ', permissions: ['b.x', 'a.x', 'b.x'] }),
    ).toEqual({ name: 'Cutter', permissions: ['a.x', 'b.x'] });
  });

  it('rejects unknown fields and empty updates', () => {
    expect(
      createRoleRequestSchema.safeParse({ name: 'Cutter', permissions: [], isSystem: true })
        .success,
    ).toBe(false);
    expect(updateRoleRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRoleRequestSchema.safeParse({ permissions: [] }).success).toBe(true);
  });
});
