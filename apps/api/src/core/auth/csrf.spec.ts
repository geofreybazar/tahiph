import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE, assertCsrf } from './csrf.js';

const T = 'a'.repeat(43);
function req(method: string, headers: Record<string, string>): Request {
  return { method, headers } as unknown as Request;
}
const code = (fn: () => void) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { code: string }).code;
  }
};

describe('assertCsrf', () => {
  const good = { origin: 'https://app.tahi.ph', cookie: `${CSRF_COOKIE}=${T}`, 'x-csrf-token': T };

  it('ignores safe methods', () => {
    expect(code(() => assertCsrf(req('GET', {}), 'app.tahi.ph', true))).toBe('ok');
  });

  it('accepts a matching origin and token', () => {
    expect(code(() => assertCsrf(req('POST', good), 'app.tahi.ph', true))).toBe('ok');
  });

  it('requires an Origin naming the request host (https in production)', () => {
    const { origin: _o, ...noOrigin } = good;
    expect(code(() => assertCsrf(req('POST', noOrigin), 'app.tahi.ph', true))).toBe(
      'CSRF_ORIGIN_MISMATCH',
    );
    expect(
      code(() =>
        assertCsrf(req('POST', { ...good, origin: 'https://evil.ph' }), 'app.tahi.ph', true),
      ),
    ).toBe('CSRF_ORIGIN_MISMATCH');
    expect(
      code(() =>
        assertCsrf(req('POST', { ...good, origin: 'http://app.tahi.ph' }), 'app.tahi.ph', true),
      ),
    ).toBe('CSRF_ORIGIN_MISMATCH');
    expect(
      code(() => assertCsrf(req('POST', { ...good, origin: 'null' }), 'app.tahi.ph', true)),
    ).toBe('CSRF_ORIGIN_MISMATCH');
    expect(
      code(() =>
        assertCsrf(req('POST', { ...good, origin: 'http://app.tahi.ph' }), 'app.tahi.ph', false),
      ),
    ).toBe('ok');
  });

  it('requires the header to equal the cookie', () => {
    expect(
      code(() =>
        assertCsrf(req('POST', { ...good, 'x-csrf-token': 'b'.repeat(43) }), 'app.tahi.ph', true),
      ),
    ).toBe('CSRF_TOKEN_INVALID');
    expect(
      code(() => assertCsrf(req('DELETE', { ...good, cookie: '' }), 'app.tahi.ph', true)),
    ).toBe('CSRF_TOKEN_INVALID');
  });
});
