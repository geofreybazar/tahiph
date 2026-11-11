import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestWithId = IncomingMessage & { id?: unknown };

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Returns the request id, creating it on first call. Both the logger (pino-http) and the
 * request context (nestjs-cls) call this, so they always agree regardless of middleware order.
 * Client-supplied ids are ignored: ids are generated server-side only.
 */
export function ensureRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const r = req as RequestWithId;
  if (typeof r.id !== 'string') r.id = randomUUID();
  // The id may have been created by an earlier caller that had no response object.
  if (res && !res.headersSent && !res.hasHeader(REQUEST_ID_HEADER)) {
    res.setHeader(REQUEST_ID_HEADER, r.id);
  }
  return r.id;
}
