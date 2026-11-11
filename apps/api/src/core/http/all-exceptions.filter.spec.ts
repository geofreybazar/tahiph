import { HttpStatus, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { DomainError } from './domain-error.js';

const cls = { getId: () => 'req-123' } as unknown as ClsService;
const filter = new AllExceptionsFilter(cls);

describe('AllExceptionsFilter.toResponse', () => {
  it('maps DomainError to its code, status and details', () => {
    const err = new DomainError('APPOINTMENT_CONFLICT', 'Overlaps.', HttpStatus.CONFLICT, [
      { path: ['startsAt'], message: 'taken' },
    ]);
    expect(filter.toResponse(err)).toEqual({
      status: 409,
      body: {
        error: {
          code: 'APPOINTMENT_CONFLICT',
          message: 'Overlaps.',
          details: [{ path: ['startsAt'], message: 'taken' }],
          requestId: 'req-123',
        },
      },
    });
  });

  it('maps Nest HttpExceptions to standard codes', () => {
    expect(filter.toResponse(new NotFoundException()).body.error.code).toBe('NOT_FOUND');
  });

  it('hides messages of 5xx HttpExceptions', () => {
    const { status, body } = filter.toResponse(
      new InternalServerErrorException('db password wrong'),
    );
    expect(status).toBe(500);
    expect(body.error.message).not.toContain('password');
  });

  it('maps Prisma P2002 to 409 CONFLICT structurally', () => {
    const err = Object.assign(new Error('Unique constraint failed on (email)'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    expect(filter.toResponse(err)).toMatchObject({
      status: 409,
      body: { error: { code: 'CONFLICT' } },
    });
    expect(filter.toResponse(err).body.error.message).not.toContain('email');
  });

  it('maps unknown errors to a generic 500 without internals', () => {
    const { status, body } = filter.toResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'req-123',
    });
  });
});
