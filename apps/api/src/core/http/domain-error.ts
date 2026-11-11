import { HttpStatus } from '@nestjs/common';

export interface ErrorDetail {
  path: (string | number)[];
  message: string;
}

/**
 * Base class for expected business/application errors. The global exception filter
 * converts these into the standard error envelope (docs/API_STANDARDS.md §5).
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationFailedError extends DomainError {
  constructor(details: ErrorDetail[]) {
    super('VALIDATION_FAILED', 'The request is invalid.', HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'The requested resource was not found.') {
    super('NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message: string, details?: ErrorDetail[]) {
    super('SERVICE_UNAVAILABLE', message, HttpStatus.SERVICE_UNAVAILABLE, details);
  }
}
