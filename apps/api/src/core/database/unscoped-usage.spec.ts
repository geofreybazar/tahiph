import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UNSCOPED_PRISMA bypasses tenant scoping (RLS still applies). Only these directories may
 * use it (docs/MULTI_TENANCY.md §4, CLAUDE.md rule 2). Extend the list only with review.
 */
const ALLOWED = [
  'core/audit/',
  'core/auth/',
  'core/database/',
  'core/tenancy/',
  'modules/health/',
  'modules/auth/',
  'modules/tenants/',
  'modules/platform/',
];

const SRC = join(import.meta.dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : files(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('UNSCOPED_PRISMA usage', () => {
  it('is confined to allow-listed modules', () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .filter((rel) => readFileSync(join(SRC, rel), 'utf8').includes('UNSCOPED_PRISMA'))
      .filter((rel) => !ALLOWED.some((dir) => rel.startsWith(dir)));
    expect(offenders).toEqual([]);
  });
});
