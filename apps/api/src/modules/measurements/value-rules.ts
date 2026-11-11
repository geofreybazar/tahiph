import type { ErrorDetail } from '../../core/http/domain-error.js';

/** Problems with record values against a template's fields: unknown keys, missing required ones. */
export function valueProblems(
  fields: readonly { key: string; required: boolean }[],
  values: Readonly<Record<string, string>>,
): ErrorDetail[] {
  const known = new Set(fields.map((f) => f.key));
  const problems: ErrorDetail[] = Object.keys(values)
    .filter((k) => !known.has(k))
    .map((k) => ({ path: ['values', k], message: 'Not a field of the current template' }));
  for (const f of fields) {
    if (f.required && values[f.key] === undefined) {
      problems.push({ path: ['values', f.key], message: 'Required' });
    }
  }
  if (Object.keys(values).length === 0) {
    problems.push({ path: ['values'], message: 'Enter at least one measurement' });
  }
  return problems;
}
