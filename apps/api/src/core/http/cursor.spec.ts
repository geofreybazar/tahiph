import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';
import { ValidationFailedError } from './domain-error.js';

describe('list cursor', () => {
  it('round-trips', () => {
    const c = { createdAt: new Date('2026-11-11T03:00:00.123Z'), id: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it.each(['', 'not-base64!', Buffer.from('[1,2]').toString('base64url')])(
    'rejects %j as a validation error',
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(ValidationFailedError);
    },
  );
});
