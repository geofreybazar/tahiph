import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  stepAt,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B (SHA-1 seed). The RFC lists 8-digit codes; 6 digits are their last 6.
const SEED = Buffer.from('12345678901234567890', 'ascii');
const VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
];

describe('TOTP', () => {
  it.each(VECTORS)('matches RFC 6238 at t=%i', (t, code) => {
    expect(hotp(SEED, Math.floor(t / 30), 8)).toBe(code);
    expect(hotp(SEED, Math.floor(t / 30))).toBe(code.slice(2));
  });

  it('accepts codes within ±1 step and returns the matched step', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(SEED, hotp(SEED, step), now)).toBe(step);
    expect(verifyTotp(SEED, hotp(SEED, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(SEED, hotp(SEED, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(SEED, hotp(SEED, step - 2), now)).toBeNull();
    expect(verifyTotp(SEED, '12345', now)).toBeNull();
    expect(verifyTotp(SEED, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32 (RFC 4648 test vector)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode(base32Encode(SEED))).toEqual(SEED);
  });

  it('builds an otpauth URI', () => {
    const uri = otpauthUri(SEED, 'ops@tahi.ph');
    expect(uri.startsWith('otpauth://totp/TAHI.ph%20Admin%3Aops%40tahi.ph?')).toBe(true);
    expect(new URL(uri).searchParams.get('secret')).toBe(base32Encode(SEED));
  });

  it('generates distinct, readable recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(normalizeRecoveryCode(' K7M2Q-X9P4T ')).toBe('k7m2qx9p4t');
  });
});
