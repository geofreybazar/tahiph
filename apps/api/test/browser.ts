import { randomInt } from 'node:crypto';
import request from 'supertest';

type App = Parameters<typeof request>[0];

/**
 * A minimal browser for integration tests: keeps cookies (including __Host-/Secure ones,
 * which supertest's agent drops over plain HTTP), sends Origin + CSRF token on unsafe
 * requests, and uses its own client IP (X-Forwarded-For, trusted from loopback in tests).
 */
export class Browser {
  readonly cookies = new Map<string, string>();
  readonly ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;

  constructor(
    private readonly server: () => App,
    readonly host: string,
    /** Endpoint that issues the CSRF cookie for this host's realm. */
    private readonly csrfPath = 'auth/csrf',
  ) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(res: request.Response): void {
    const raw = res.headers['set-cookie'] as unknown;
    const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string) {
    const res = await request(this.server())
      .get(`/api/v1/${path}`)
      .set('Host', this.host)
      .set('X-Forwarded-For', this.ip)
      .set('Cookie', this.cookieHeader());
    this.store(res);
    return res;
  }

  post(path: string, body: object = {}) {
    return this.send('post', path, body);
  }

  /** An unsafe request (POST/PUT/PATCH/DELETE) with Origin and CSRF token. */
  async send(method: 'post' | 'put' | 'patch' | 'delete', path: string, body: object = {}) {
    if (!this.cookies.has('__Host-tahi_csrf')) await this.get(this.csrfPath);
    const agent = request(this.server());
    const res = await agent[method](`/api/v1/${path}`)
      .set('Host', this.host)
      .set('Origin', `http://${this.host}`)
      .set('X-CSRF-Token', this.cookies.get('__Host-tahi_csrf') ?? '')
      .set('X-Forwarded-For', this.ip)
      .set('Cookie', this.cookieHeader())
      .send(body);
    this.store(res);
    return res;
  }

  /** Raw Set-Cookie headers of a response, for attribute checks. */
  static setCookies(res: request.Response): string[] {
    const raw = res.headers['set-cookie'] as unknown;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }
}
