import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ApiErrorCode, ApiFailure, ApiFieldError } from '@tahi/shared';
import { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { ApiException } from './api-exception';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_RULE_VIOLATION',
  429: 'RATE_LIMITED',
};

interface Described {
  status: number;
  code: ApiErrorCode;
  message: string;
  details: ApiFieldError[];
}

function describe(exception: unknown): Described {
  if (exception instanceof ZodValidationException) {
    const issues = (exception.getZodError() as ZodError).issues;
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    };
  }
  if (exception instanceof ApiException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }
  // Body-parser failures (malformed JSON, oversized body) carry a status but aren't HttpExceptions.
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : (exception as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      status,
      code: CODE_BY_STATUS[status] ?? 'BAD_REQUEST',
      message:
        exception instanceof HttpException
          ? exception.message
          : 'The request could not be processed',
      details: [],
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong', details: [] };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const { status, code, message, details } = describe(exception);

    if (status === 500) {
      this.logger.error(exception instanceof Error ? exception.stack : 'Non-error thrown');
    }

    const body: ApiFailure = {
      success: false,
      statusCode: status,
      error: { code, message, details },
      timestamp: new Date().toISOString(),
      // Without the query string, which may hold personal data.
      path: request.originalUrl.split('?')[0] ?? request.originalUrl,
    };
    http.getResponse<Response>().status(status).json(body);
  }
}
