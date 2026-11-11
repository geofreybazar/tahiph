import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationFailedError } from './domain-error.js';

/**
 * Validates and parses params/query/body with a Zod schema from @tahi/validation.
 * Parsing (not just validating) means unknown keys are stripped and defaults/coercions applied.
 *
 * @example `@Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery`
 */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationFailedError(
        result.error.issues.map((issue) => ({
          path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
