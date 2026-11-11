import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

const key = () => randomBytes(32);

describe('SecretBox (AES-256-GCM)', () => {
  it('round-trips and binds ciphertext to its associated data', () => {
    const box = new SecretBox([{ id: 'k1', key: key() }]);
    const ct = box.encrypt(Buffer.from('totp-secret'), 'platform_user:1');
    expect(box.decrypt(ct, 'platform_user:1').toString()).toBe('totp-secret');
    expect(() => box.decrypt(ct, 'platform_user:2')).toThrow();
  });

  it('detects tampering', () => {
    const box = new SecretBox([{ id: 'k1', key: key() }]);
    const ct = box.encrypt(Buffer.from('x'), 'a');
    ct[ct.length - 1]! ^= 1;
    expect(() => box.decrypt(ct, 'a')).toThrow();
  });

  it('decrypts with retired keys after rotation and encrypts with the first', () => {
    const k1 = key();
    const old = new SecretBox([{ id: 'k1', key: k1 }]);
    const ct = old.encrypt(Buffer.from('s'), 'a');
    const rotated = new SecretBox([
      { id: 'k2', key: key() },
      { id: 'k1', key: k1 },
    ]);
    expect(rotated.decrypt(ct, 'a').toString()).toBe('s');
    expect(
      Buffer.from(rotated.encrypt(Buffer.from('s'), 'a'))
        .subarray(2, 4)
        .toString(),
    ).toBe('k2');
  });

  it('parses the env format and rejects bad keys', () => {
    expect(() => SecretBox.fromEnv(`k1:${key().toString('base64')}`)).not.toThrow();
    expect(() => SecretBox.fromEnv(`k1:${randomBytes(16).toString('base64')}`)).toThrow(/32 bytes/);
    expect(() => SecretBox.fromEnv('nokey')).toThrow();
  });
});
