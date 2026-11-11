import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** Paginated result returned by services; serialized as `{ data, meta }`. */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { nextCursor: string | null; hasMore: boolean },
  ) {}
}

/** Wraps successful responses in the standard `{ data }` / `{ data, meta }` envelope. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        map((value: unknown) =>
          value instanceof Paginated
            ? { data: value.items, meta: value.meta }
            : { data: value ?? null },
        ),
      );
  }
}
