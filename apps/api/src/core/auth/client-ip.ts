import type { Request } from 'express';
import type { Env } from '../config/env.js';

/**
 * Client IP for throttling and audit. Behind Cloudflare the edge sets CF-Connecting-IP, and only
 * Cloudflare can reach Traefik, so the configured header is trusted (docs/AUTHENTICATION §5).
 */
export function clientIp(req: Request, env: Pick<Env, 'CLIENT_IP_HEADER'>): string {
  if (env.CLIENT_IP_HEADER) {
    const v = req.headers[env.CLIENT_IP_HEADER];
    const ip = (Array.isArray(v) ? v[0] : v)?.trim();
    if (ip && ip.length <= 64) return ip;
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
