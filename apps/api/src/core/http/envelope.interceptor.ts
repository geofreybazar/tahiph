import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RESPONSE_SCHEMA_KEY, type ResponseContract } from './contract.js';

/** Paginated result returned by services; serialized as `{ data, meta }`. */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { nextCursor: string | null; hasMore: boolean },
  ) {}
}

/**
 * Wraps successful responses in the standard `{ data }` / `{ data, meta }` envelope, after
 * parsing them with the route's @ResponseSchema(). Parsing strips undeclared fields, so
 * internal data cannot leak by accident; a mismatch is a server bug and becomes a 500.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const contract = this.reflector.get<ResponseContract | undefined>(
      RESPONSE_SCHEMA_KEY,
      context.getHandler(),
    );
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof Paginated) {
          const items = contract ? value.items.map((i) => contract.schema.parse(i)) : value.items;
          return { data: items, meta: value.meta };
        }
        return { data: contract ? contract.schema.parse(value) : (value ?? null) };
      }),
    );
  }
}
