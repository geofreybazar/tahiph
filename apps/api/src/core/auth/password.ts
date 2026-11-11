import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id via Node's built-in implementation (no native dependency).
 * OWASP baseline: 19 MiB, 2 passes, parallelism 1 (docs/AUTHENTICATION_AND_AUTHORIZATION.md §4).
 * Stored in PHC format: $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash> (base64, unpadded).
 */
export const ARGON2_PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 } as const;

function derive(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, ARGON2_PARAMS);
  const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export interface VerifyResult {
  ok: boolean;
  /** Stored hash uses weaker parameters than ARGON2_PARAMS; rehash on successful login. */
  needsRehash: boolean;
}

export async function verifyPassword(stored: string, password: string): Promise<VerifyResult> {
  const m = PHC.exec(stored);
  if (!m) return { ok: false, needsRehash: false };
  const [memory, passes, parallelism] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await derive(password, Buffer.from(m[4]!, 'base64'), {
    memory,
    passes,
    parallelism,
    tagLength: expected.length,
  });
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash =
    memory < ARGON2_PARAMS.memory ||
    passes < ARGON2_PARAMS.passes ||
    expected.length < ARGON2_PARAMS.tagLength;
  return { ok, needsRehash: ok && needsRehash };
}
