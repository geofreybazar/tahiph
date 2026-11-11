import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ensureRequestId, REQUEST_ID_HEADER } from './request-id.js';

function fakeRes() {
  const headers = new Map<string, string>();
  return {
    headersSent: false,
    hasHeader: (k: string) => headers.has(k.toLowerCase()),
    setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
    headers,
  };
}

describe('ensureRequestId', () => {
  it('is stable across callers and sets the header even if first created without a response', () => {
    const req = { headers: {} } as IncomingMessage;
    const res = fakeRes();
    const first = ensureRequestId(req); // e.g. nestjs-cls idGenerator (no res)
    const second = ensureRequestId(req, res as unknown as ServerResponse); // e.g. pino-http
    expect(second).toBe(first);
    expect(res.headers.get(REQUEST_ID_HEADER.toLowerCase())).toBe(first);
  });

  it('ignores a client-supplied id', () => {
    const req = { headers: { 'x-request-id': 'forged' } } as unknown as IncomingMessage;
    expect(ensureRequestId(req)).not.toBe('forged');
  });
});
