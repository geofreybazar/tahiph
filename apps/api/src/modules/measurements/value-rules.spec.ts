import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES } from './default-templates.js';
import { valueProblems } from './value-rules.js';

const fields = [
  { key: 'suit.bust', required: true },
  { key: 'suit.neck', required: false },
];

describe('valueProblems', () => {
  it('accepts known keys with required ones present', () => {
    expect(valueProblems(fields, { 'suit.bust': '38' })).toEqual([]);
  });

  it('reports unknown keys, missing required keys and empty records', () => {
    expect(valueProblems(fields, { 'gown.bust': '38' }).map((p) => p.path)).toEqual([
      ['values', 'gown.bust'],
      ['values', 'suit.bust'],
    ]);
    expect(valueProblems([], {}).map((p) => p.path)).toEqual([['values']]);
  });
});

describe('DEFAULT_TEMPLATES', () => {
  it('have unique, valid keys per template', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const keys = t.sections.flatMap(([, f]) => f.map((x) => x.key));
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/);
    }
  });
});
