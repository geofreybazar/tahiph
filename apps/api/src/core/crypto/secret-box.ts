import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for secrets at rest: TOTP secrets now, tenant provider credentials
 * later (docs/AUTHENTICATION_AND_AUTHORIZATION.md §4).
 *
 * Layout: [version=1][keyIdLength][keyId utf8][iv 12][tag 16][ciphertext]. The key id lets old
 * ciphertexts decrypt after rotation. The first key in the ring encrypts.
 */
export class SecretBox {
  private readonly keys: Map<string, Buffer>;
  private readonly activeId: string;

  constructor(ring: readonly { id: string; key: Buffer }[]) {
    if (ring.length === 0) throw new Error('SecretBox needs at least one key');
    for (const k of ring) {
      if (k.key.length !== 32) throw new Error(`Encryption key ${k.id} must be 32 bytes`);
    }
    this.keys = new Map(ring.map((k) => [k.id, k.key]));
    this.activeId = ring[0]!.id;
  }

  /** Parses "id:base64key,id2:base64key" (first = active). */
  static fromEnv(value: string): SecretBox {
    return new SecretBox(
      value.split(',').map((entry) => {
        const [id, b64] = entry.split(':');
        if (!id || !b64) throw new Error('ENCRYPTION_KEYS entries must be id:base64key');
        return { id, key: Buffer.from(b64, 'base64') };
      }),
    );
  }

  /** Associated data binds a ciphertext to its use (e.g. the owning row id). */
  encrypt(plaintext: Buffer, aad: string): Uint8Array<ArrayBuffer> {
    const id = Buffer.from(this.activeId, 'utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeId)!, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return new Uint8Array(
      Buffer.concat([Buffer.from([1, id.length]), id, iv, cipher.getAuthTag(), ct]),
    );
  }

  decrypt(blob: Uint8Array, aad: string): Buffer {
    const b = Buffer.from(blob);
    if (b[0] !== 1) throw new Error('Unsupported ciphertext version');
    const idLen = b[1]!;
    const id = b.subarray(2, 2 + idLen).toString('utf8');
    const key = this.keys.get(id);
    if (!key) throw new Error(`Unknown encryption key id ${id}`);
    const at = 2 + idLen;
    const decipher = createDecipheriv('aes-256-gcm', key, b.subarray(at, at + 12));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(b.subarray(at + 12, at + 28));
    return Buffer.concat([decipher.update(b.subarray(at + 28)), decipher.final()]);
  }
}

export const SECRET_BOX = Symbol('SECRET_BOX');
