import { HttpException } from '@nestjs/common';
import { ApiErrorCode, ApiFieldError } from '@tahi/shared';

export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: ApiFieldError[] = [],
  ) {
    super(message, status);
  }
}
