import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 30 s steps, 6 digits): what authenticator apps support. */
export const TOTP = { stepSeconds: 30, digits: 6, window: 1 } as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i === -1) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes (160 bits), as RFC 4226 recommends. */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP.stepSeconds);
}

export function hotp(secret: Buffer, counter: number, digits: number = TOTP.digits): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, '0');
}

/**
 * Returns the matching time step within ±window, or null. Callers must reject steps at or
 * below the last accepted one (replay protection).
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  let match: number | null = null;
  for (let d = -TOTP.window; d <= TOTP.window; d++) {
    const expected = Buffer.from(hotp(secret, current + d));
    // Compare every candidate (constant work regardless of which one matches).
    if (timingSafeEqual(expected, Buffer.from(code)) && match === null) match = current + d;
  }
  return match;
}

/** otpauth:// URI for QR enrollment. */
export function otpauthUri(secret: Buffer, account: string, issuer = 'TAHI.ph Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP.digits),
    period: String(TOTP.stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

/** Ten single-use recovery codes like "k7m2q-x9p4t" (~49 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s-]/g, '');
}
