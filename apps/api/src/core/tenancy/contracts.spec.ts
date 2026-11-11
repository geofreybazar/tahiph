import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tenant context comes only from the server (session or Host). Request contracts in
 * @tahi/validation must never carry a tenant id (docs/MULTI_TENANCY.md §3). Platform-realm
 * endpoints take the tenant in the URL path, not in a schema field.
 */
const VALIDATION_SRC = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'validation',
  'src',
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('@tahi/validation contracts', () => {
  it('are found', () => {
    expect(files(VALIDATION_SRC).length).toBeGreaterThan(0);
  });

  it('contain no tenantId field', () => {
    const offenders = files(VALIDATION_SRC).filter((f) =>
      /tenant_?id/i.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
