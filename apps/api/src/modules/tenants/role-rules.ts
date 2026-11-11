import { isTenantPermission, OWNER_ONLY_PERMISSIONS, type Permission } from '@tahi/types';
import type { ErrorDetail } from '../../core/http/domain-error.js';

/**
 * Problems with changing a role's permissions from `current` to `next` by a caller holding
 * `held` (ADR-025): every permission must exist, owner-only ones are never granted, and the
 * caller may only add or remove permissions they hold themselves (no escalation).
 */
export function permissionChangeProblems(
  current: readonly string[],
  next: readonly string[],
  held: ReadonlySet<Permission>,
): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  next.forEach((p, i) => {
    if (!isTenantPermission(p)) {
      problems.push({ path: ['permissions', i], message: `Unknown permission ${p}` });
    } else if (OWNER_ONLY_PERMISSIONS.includes(p)) {
      problems.push({ path: ['permissions', i], message: `${p} belongs to the Owner only` });
    }
  });
  const before = new Set(current);
  const after = new Set(next);
  const changed = [...next.filter((p) => !before.has(p)), ...current.filter((p) => !after.has(p))];
  for (const p of changed) {
    if (isTenantPermission(p) && !held.has(p)) {
      problems.push({
        path: ['permissions'],
        message: `You cannot grant or remove ${p}, which you do not hold`,
      });
    }
  }
  return problems;
}
