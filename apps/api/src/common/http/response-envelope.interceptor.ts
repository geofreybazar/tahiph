import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ApiSuccess } from '@tahi/shared';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { Paginated } from './paginated';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown> | void> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((value: unknown) => {
        if (response.statusCode === 204) return;
        const timestamp = new Date().toISOString();
        return value instanceof Paginated
          ? { success: true, data: value.items, meta: value.meta, timestamp }
          : { success: true, data: value, timestamp };
      }),
    );
  }
}
