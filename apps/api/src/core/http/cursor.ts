import { z } from 'zod';
import { ValidationFailedError } from './domain-error.js';

/** Keyset position for lists ordered by (createdAt DESC, id DESC) (API_STANDARDS.md §6). */
export interface CreatedCursor {
  createdAt: Date;
  id: string;
}

const payloadSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/** Opaque base64url of [createdAt, id]. */
export function encodeCursor(c: CreatedCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt.toISOString(), c.id])).toString('base64url');
}

/** Decodes a client-supplied cursor; anything malformed is a 422 on `cursor`. */
export function decodeCursor(raw: string): CreatedCursor {
  try {
    const [createdAt, id] = payloadSchema.parse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
    return { createdAt: new Date(createdAt), id };
  } catch {
    throw new ValidationFailedError([{ path: ['cursor'], message: 'Invalid cursor' }]);
  }
}

/** Prisma `where` for rows after the cursor in (createdAt DESC, id DESC) order. */
export function afterCursor(c: CreatedCursor) {
  return {
    OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
  };
}
