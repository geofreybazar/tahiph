import type { SessionRealm } from '@tahi/database';
import type { Response } from 'express';
import { SESSION_COOKIES } from './cookies.js';
import { SESSION_LIFETIMES } from './session.service.js';

/** __Host- cookies: Secure, Path=/, no Domain (host-only). Browsers treat *.localhost as secure. */
export function setSessionCookie(res: Response, realm: SessionRealm, token: string): void {
  res.cookie(SESSION_COOKIES[realm], token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIMES[realm].absoluteMs,
  });
}

export function clearSessionCookie(res: Response, realm: SessionRealm): void {
  res.clearCookie(SESSION_COOKIES[realm], {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}
