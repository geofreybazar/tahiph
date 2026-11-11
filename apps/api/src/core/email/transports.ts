import { Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';
import type { EmailMessage, EmailTransport } from './email.types.js';

/** "Name <addr>" → parts. */
export function parseAddress(from: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { ...(m[1] ? { name: m[1] } : {}), email: m[2]! } : { email: from.trim() };
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // The body may echo the request; keep only the status in errors.
    throw new Error(`email provider responded ${res.status}`);
  }
}

/** Local development: Mailpit's send API (docker-compose.yml). */
export class MailpitTransport implements EmailTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly from: string,
  ) {}

  async deliver(m: EmailMessage): Promise<void> {
    const from = parseAddress(this.from);
    await post(`${this.baseUrl}/api/v1/send`, {
      From: { Email: from.email, ...(from.name ? { Name: from.name } : {}) },
      To: [{ Email: m.to }],
      Subject: m.subject,
      Text: m.text,
      HTML: m.html,
    });
  }
}

/** Production: Resend HTTP API. */
export class ResendTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async deliver(m: EmailMessage): Promise<void> {
    await post(
      'https://api.resend.com/emails',
      { from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html },
      { authorization: `Bearer ${this.apiKey}` },
    );
  }
}

/** Tests/CI: logs metadata only (never the body, which may hold one-time links). */
export class LogTransport implements EmailTransport {
  private readonly logger = new Logger('EmailLog');

  deliver(m: EmailMessage): Promise<void> {
    this.logger.log({ subject: m.subject }, 'email delivered to log transport');
    return Promise.resolve();
  }
}

export function createTransport(env: Env): EmailTransport {
  switch (env.EMAIL_TRANSPORT) {
    case 'mailpit':
      return new MailpitTransport(env.MAILPIT_URL, env.EMAIL_FROM);
    case 'resend':
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required');
      return new ResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
    case 'log':
      return new LogTransport();
  }
}
