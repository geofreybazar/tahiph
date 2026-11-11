import { argon2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (Argon2id)', () => {
  it('produces a PHC string with the configured parameters and a random salt', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects others', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword(h, 'correct horse battery')).toEqual({
      ok: true,
      needsRehash: false,
    });
    expect((await verifyPassword(h, 'correct horse batterY')).ok).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    const salt = randomBytes(16);
    const key = argon2Sync('argon2id', {
      message: 'pw-1234567',
      nonce: salt,
      memory: 8192,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
    });
    const b64 = (x: Buffer) => x.toString('base64').replace(/=+$/, '');
    const weak = `$argon2id$v=19$m=8192,t=1,p=1$${b64(salt)}$${b64(key)}`;
    expect(await verifyPassword(weak, 'pw-1234567')).toEqual({ ok: true, needsRehash: true });
  });

  it('rejects malformed hashes without throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toEqual({ ok: false, needsRehash: false });
    expect(await verifyPassword('$2b$10$bcrypt-style', 'x')).toEqual({
      ok: false,
      needsRehash: false,
    });
  });
});
