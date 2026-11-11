import { paginationQuerySchema } from '@tahi/validation';
import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from './domain-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(paginationQuerySchema);

  it('returns parsed output with defaults and coercion, stripping unknown keys', () => {
    expect(pipe.transform({ limit: '10', tenantId: 'forged' })).toEqual({ limit: 10 });
  });

  it('throws ValidationFailedError with field paths', () => {
    try {
      pipe.transform({ limit: '0' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationFailedError);
      expect((err as ValidationFailedError).details?.[0]?.path).toEqual(['limit']);
    }
  });
});
