import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { ensureRequestId } from '../context/request-id.js';
import { DomainError, type ErrorDetail } from './domain-error.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: ErrorDetail[]; requestId: string };
}

const HTTP_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Known Prisma request errors, matched structurally so this filter has no Prisma dependency. */
const PRISMA_ERRORS: Record<string, { status: HttpStatus; code: string; message: string }> = {
  P2002: { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'The resource already exists.' },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
  },
};

function prismaErrorCode(exception: unknown): string | undefined {
  if (
    exception instanceof Error &&
    exception.name === 'PrismaClientKnownRequestError' &&
    'code' in exception &&
    typeof exception.code === 'string'
  ) {
    return exception.code;
  }
  return undefined;
}

/** Converts every thrown value into the standard error envelope. Never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    // Errors raised before the context middleware (e.g. body-parser limits) have no CLS id.
    const requestId = this.cls.getId() ?? ensureRequestId(http.getRequest<Request>(), res);
    const { status, body } = this.toResponse(exception, requestId);
    if (status >= 500) {
      this.logger.error({ err: exception, requestId: body.error.requestId }, 'Unhandled error');
    }
    res.status(status).json(body);
  }

  toResponse(
    exception: unknown,
    requestId: string = this.cls.getId() ?? 'unknown',
  ): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
            requestId,
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
      // 5xx HttpExceptions may carry internal messages; replace them.
      const message = status >= 500 ? 'An unexpected error occurred.' : exception.message;
      return { status, body: { error: { code, message, requestId } } };
    }

    const prismaCode = prismaErrorCode(exception);
    const mapped = prismaCode ? PRISMA_ERRORS[prismaCode] : undefined;
    if (mapped) {
      return {
        status: mapped.status,
        body: { error: { code: mapped.code, message: mapped.message, requestId } },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId },
      },
    };
  }
}
