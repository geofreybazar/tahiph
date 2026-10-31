import { PaginationMeta, PaginationQuery } from '@tahi/shared';

/** Return from a controller to get a paginated response from the envelope interceptor. */
export class Paginated<T> {
  readonly meta: PaginationMeta;

  constructor(
    readonly items: T[],
    { page, limit }: PaginationQuery,
    total: number,
  ) {
    this.meta = { page, limit, total, totalPages: Math.ceil(total / limit) };
  }
}
