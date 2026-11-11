import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { ForbiddenError } from '../http/domain-error.js';
import { readCookie } from './cookies.js';

export const CSRF_COOKIE = '__Host-tahi_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests
 * (docs/AUTHENTICATION_AND_AUTHORIZATION.md §6):
 * 1. Origin must be present and name the request host (https in production);
 * 2. double-submit: the X-CSRF-Token header must equal the __Host-tahi_csrf cookie.
 */
export function assertCsrf(req: Request, host: string, production: boolean): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  let originUrl: URL | undefined;
  try {
    originUrl = origin ? new URL(origin) : undefined;
  } catch {
    originUrl = undefined;
  }
  if (
    !originUrl ||
    originUrl.hostname !== host ||
    (production
      ? originUrl.protocol !== 'https:'
      : !['https:', 'http:'].includes(originUrl.protocol))
  ) {
    throw new ForbiddenError('CSRF_ORIGIN_MISMATCH', 'The request origin is not allowed.');
  }
  const cookie = readCookie(req.headers.cookie, CSRF_COOKIE);
  const header = req.headers[CSRF_HEADER];
  const sent = Array.isArray(header) ? header[0] : header;
  if (
    !cookie ||
    !sent ||
    cookie.length !== sent.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(sent))
  ) {
    throw new ForbiddenError('CSRF_TOKEN_INVALID', 'The CSRF token is missing or invalid.');
  }
}

/** Returns the existing CSRF token or issues a new one (readable by the page's JavaScript). */
export function issueCsrfToken(req: Request, res: Response): string {
  const existing = readCookie(req.headers.cookie, CSRF_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: true, sameSite: 'strict', path: '/' });
  return token;
}
