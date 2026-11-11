import { describe, expect, it } from 'vitest';
import {
  clientListQuerySchema,
  createClientRequestSchema,
  createCommunicationRequestSchema,
  updateClientRequestSchema,
} from './clients.js';

describe('client requests', () => {
  it('needs only a first name, and normalizes tags and email', () => {
    expect(
      createClientRequestSchema.parse({
        firstName: ' Ana ',
        email: 'Ana@Example.TEST',
        tags: ['Bride', 'bride ', 'VIP'],
      }),
    ).toEqual({ firstName: 'Ana', email: 'ana@example.test', tags: ['bride', 'vip'] });
    expect(createClientRequestSchema.safeParse({ lastName: 'Cruz' }).success).toBe(false);
  });

  it('clears fields with null or blank on update', () => {
    expect(updateClientRequestSchema.parse({ phone: '  ', email: '', lastName: null })).toEqual({
      phone: null,
      email: null,
      lastName: null,
    });
    expect(updateClientRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown fields such as tenantId and bad dates', () => {
    expect(createClientRequestSchema.safeParse({ firstName: 'A', tenantId: 'x' }).success).toBe(
      false,
    );
    expect(
      createClientRequestSchema.safeParse({ firstName: 'A', birthday: '1990-02-30' }).success,
    ).toBe(false);
  });

  it('defaults the list to active clients and coerces the limit', () => {
    expect(clientListQuerySchema.parse({ limit: '10', tag: 'VIP' })).toEqual({
      limit: 10,
      tag: 'vip',
      status: 'active',
    });
  });

  it('accepts communication times with an offset', () => {
    expect(
      createCommunicationRequestSchema.safeParse({
        channel: 'CALL',
        direction: 'INBOUND',
        summary: 'Asked about fittings',
        occurredAt: '2026-11-11T09:30:00+08:00',
      }).success,
    ).toBe(true);
  });
});
