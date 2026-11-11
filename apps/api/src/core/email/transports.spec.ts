import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitation, verifyEmail } from '../../modules/auth/emails.js';
import { MailpitTransport, ResendTransport, parseAddress } from './transports.js';

const msg = { to: 'm@example.ph', subject: 'S', text: 'T', html: '<p>H</p>' };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status = 200) {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(new Response('{}', { status })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('email transports', () => {
  it('parses "Name <addr>" senders', () => {
    expect(parseAddress('TAHI.ph <no-reply@tahi.ph>')).toEqual({
      name: 'TAHI.ph',
      email: 'no-reply@tahi.ph',
    });
    expect(parseAddress('no-reply@tahi.ph')).toEqual({ email: 'no-reply@tahi.ph' });
  });

  it('posts to the Mailpit send API', async () => {
    const f = stubFetch();
    await new MailpitTransport('http://mailpit:8025', 'TAHI <n@t.ph>').deliver(msg);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://mailpit:8025/api/v1/send');
    expect(JSON.parse(init.body as string)).toEqual({
      From: { Email: 'n@t.ph', Name: 'TAHI' },
      To: [{ Email: 'm@example.ph' }],
      Subject: 'S',
      Text: 'T',
      HTML: '<p>H</p>',
    });
  });

  it('posts to Resend with the API key and fails on non-2xx without echoing the body', async () => {
    const f = stubFetch();
    await new ResendTransport('key-1', 'n@t.ph').deliver(msg);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
    stubFetch(422);
    await expect(new ResendTransport('key-1', 'n@t.ph').deliver(msg)).rejects.toThrow(
      'email provider responded 422',
    );
  });
});

describe('email templates', () => {
  it('escapes user-controlled text in HTML', () => {
    const m = invitation(
      'x@y.ph',
      '<script>alert(1)</script>',
      'Designer',
      'https://app.tahi.ph/a?token=t',
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&#60;script&#62;');
    expect(verifyEmail('x@y.ph', 'A & B', 'https://u').html).toContain('A &#38; B');
  });
});
