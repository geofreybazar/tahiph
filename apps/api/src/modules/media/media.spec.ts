import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { JWT_KEY_SET } from '../../common/auth/jwt-verifier';
import { Env } from '../../common/config/env';
import { ENV } from '../../common/config/env.token';
import { BASE_PRISMA } from '../../common/prisma/base-prisma.token';
import { StorageService, StoredObject } from '../../common/storage/storage.service';
import { PrismaClient } from '../../generated/prisma/client';
import { MediaCleanupJob } from './media-cleanup.job';
import { sniffMimeType } from './media-types';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ISSUER = 'https://test.supabase.co/auth/v1';

describe('sniffMimeType', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('recognises each allowed type', () => {
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(bytes('RIFF\0\0\0\0WEBPVP8'))).toBe('image/webp');
    expect(sniffMimeType(bytes('%PDF-1.7'))).toBe('application/pdf');
  });

  it.each(['<svg onload=alert(1)>', '<html>', 'RIFF\0\0\0\0WAVE', '', '#!/bin/sh'])(
    'rejects %j',
    (text) => {
      expect(sniffMimeType(bytes(text))).toBeNull();
    },
  );
});

describe('media', () => {
  let app: NestExpressApplication;
  let base: PrismaClient;
  let privateKey: CryptoKey;
  let tenantA: string;
  let tenantB: string;
  const objects = new Map<string, StoredObject>();
  const removed: string[] = [];
  const storage = {
    createUploadUrl: vi.fn(
      async (_bucket: string, key: string) => `https://storage.test/up/${key}`,
    ),
    createDownloadUrl: vi.fn(async (_b: string, key: string) => `https://storage.test/get/${key}`),
    inspect: vi.fn(async (_bucket: string, key: string) => objects.get(key) ?? null),
    remove: vi.fn(async (_bucket: string, keys: string[]) => {
      keys.forEach((key) => objects.delete(key));
      removed.push(...keys);
    }),
  };

  const token = (userId: string) =>
    new SignJWT({ email: `${userId}@example.test` })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('5m')
      .sign(privateKey);

  const call = async (
    method: 'get' | 'post' | 'delete',
    path: string,
    userId: string,
    tenantId: string,
    body?: object,
  ) => {
    const server = request(app.getHttpServer());
    const req = server[method](`/api/v1/media${path}`)
      .set('Authorization', `Bearer ${await token(userId)}`)
      .set('X-Tenant-Id', tenantId);
    return body ? req.send(body) : req;
  };

  async function member(tenantId: string, role: 'owner' | 'admin' | 'staff') {
    const userId = randomUUID();
    await base.user.create({ data: { id: userId, email: `${userId}@example.test` } });
    await base.tenantMembership.create({ data: { tenantId, userId, role } });
    return userId;
  }

  const intent = {
    purpose: 'fitting_photo',
    mimeType: 'image/png',
    sizeBytes: 100,
    filename: 'look.png',
  };

  async function uploaded(userId: string, tenantId: string) {
    const res = await call('post', '/upload-intents', userId, tenantId, intent);
    expect(res.status).toBe(201);
    const row = await base.mediaFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
    objects.set(row.objectKey, { sizeBytes: 100, leadingBytes: PNG });
    return row;
  }

  beforeAll(async () => {
    const keys = await generateKeyPair('ES256', { extractable: true });
    privateKey = keys.privateKey;
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JWT_KEY_SET)
      .useValue(createLocalJWKSet({ keys: [jwk] }))
      .overrideProvider(StorageService)
      .useValue(storage)
      .setLogger(false as never)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, moduleRef.get<Env>(ENV));
    await app.init();
    base = moduleRef.get(BASE_PRISMA);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    const unique = randomUUID().slice(0, 8);
    tenantA = (await base.tenant.create({ data: { slug: `a-${unique}`, name: 'A' } })).id;
    tenantB = (await base.tenant.create({ data: { slug: `b-${unique}`, name: 'B' } })).id;
    objects.clear();
    removed.length = 0;
  });

  it('generates the key itself, inside the tenant folder, ignoring the filename', async () => {
    const user = await member(tenantA, 'staff');
    const res = await call('post', '/upload-intents', user, tenantA, {
      ...intent,
      filename: `../../${tenantB}/evil.png`,
    });
    const row = await base.mediaFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.objectKey).toBe(`${tenantA}/fitting_photo/${row.id}.png`);
    expect(row.status).toBe('pending');
  });

  it.each([
    ['SVG', { mimeType: 'image/svg+xml' }],
    ['HTML', { mimeType: 'text/html' }],
    ['an oversized file', { sizeBytes: 25 * 1024 * 1024 + 1 }],
    ['an empty file', { sizeBytes: 0 }],
    ['an unknown purpose', { purpose: 'avatar' }],
  ])('refuses an intent for %s', async (_name, change) => {
    const user = await member(tenantA, 'owner');
    const res = await call('post', '/upload-intents', user, tenantA, { ...intent, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confirms a real upload and records its verified size', async () => {
    const user = await member(tenantA, 'staff');
    const file = await uploaded(user, tenantA);
    objects.set(file.objectKey, { sizeBytes: 77, leadingBytes: PNG });
    const res = await call('post', `/${file.id}/confirm`, user, tenantA);
    expect(res.status).toBe(200);
    const row = await base.mediaFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({ status: 'ready', sizeBytes: 77, expiresAt: null });
  });

  it('confirming twice is harmless', async () => {
    const user = await member(tenantA, 'staff');
    const file = await uploaded(user, tenantA);
    await call('post', `/${file.id}/confirm`, user, tenantA);
    const res = await call('post', `/${file.id}/confirm`, user, tenantA);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ready');
  });

  it('refuses to confirm before anything was uploaded', async () => {
    const user = await member(tenantA, 'staff');
    const res = await call('post', '/upload-intents', user, tenantA, intent);
    const confirm = await call('post', `/${res.body.data.id}/confirm`, user, tenantA);
    expect(confirm.status).toBe(409);
  });

  it('deletes a file whose contents do not match its declared type', async () => {
    const user = await member(tenantA, 'staff');
    const file = await uploaded(user, tenantA);
    const html = new TextEncoder().encode('<html><script>');
    objects.set(file.objectKey, { sizeBytes: 14, leadingBytes: html });
    const res = await call('post', `/${file.id}/confirm`, user, tenantA);
    expect(res.status).toBe(422);
    expect(removed).toContain(file.objectKey);
    expect(await base.mediaFile.findUnique({ where: { id: file.id } })).toBeNull();
  });

  it('deletes a file that is larger than the limit', async () => {
    const user = await member(tenantA, 'staff');
    const file = await uploaded(user, tenantA);
    objects.set(file.objectKey, { sizeBytes: 25 * 1024 * 1024 + 1, leadingBytes: PNG });
    const res = await call('post', `/${file.id}/confirm`, user, tenantA);
    expect(res.status).toBe(422);
    expect(removed).toContain(file.objectKey);
  });

  it('issues a short-lived download URL only for ready files', async () => {
    const user = await member(tenantA, 'staff');
    const file = await uploaded(user, tenantA);
    expect((await call('get', `/${file.id}/download-url`, user, tenantA)).status).toBe(404);
    await call('post', `/${file.id}/confirm`, user, tenantA);
    const res = await call('get', `/${file.id}/download-url`, user, tenantA);
    expect(res.status).toBe(200);
    expect(res.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
  });

  it("returns 404 for every action on another tenant's file", async () => {
    const owner = await member(tenantA, 'owner');
    const file = await uploaded(owner, tenantA);
    await call('post', `/${file.id}/confirm`, owner, tenantA);

    const outsider = await member(tenantB, 'owner');
    for (const [method, path] of [
      ['post', `/${file.id}/confirm`],
      ['get', `/${file.id}/download-url`],
      ['delete', `/${file.id}`],
    ] as const) {
      const res = await call(method, path, outsider, tenantB);
      expect(res.status, path).toBe(404);
    }
    expect(await base.mediaFile.findUnique({ where: { id: file.id } })).not.toBeNull();
    expect(removed).not.toContain(file.objectKey);
  });

  it('refuses an outsider naming a tenant they do not belong to', async () => {
    const outsider = await member(tenantB, 'owner');
    const res = await call('post', '/upload-intents', outsider, tenantA, intent);
    expect(res.status).toBe(403);
  });

  describe('expense receipts', () => {
    const receipt = { ...intent, purpose: 'expense_receipt' };

    it('refuses staff', async () => {
      const staff = await member(tenantA, 'staff');
      const res = await call('post', '/upload-intents', staff, tenantA, receipt);
      expect(res.status).toBe(403);
    });

    it('lets an owner upload but not staff download', async () => {
      const owner = await member(tenantA, 'owner');
      const res = await call('post', '/upload-intents', owner, tenantA, receipt);
      const row = await base.mediaFile.findUniqueOrThrow({ where: { id: res.body.data.id } });
      objects.set(row.objectKey, { sizeBytes: 100, leadingBytes: PNG });
      await call('post', `/${row.id}/confirm`, owner, tenantA);

      const staff = await member(tenantA, 'staff');
      expect((await call('get', `/${row.id}/download-url`, staff, tenantA)).status).toBe(403);
      expect((await call('get', `/${row.id}/download-url`, owner, tenantA)).status).toBe(200);
    });
  });

  describe('deleting', () => {
    it('lets the uploader or a manager delete, but not other staff', async () => {
      const uploader = await member(tenantA, 'staff');
      const file = await uploaded(uploader, tenantA);
      const other = await member(tenantA, 'staff');
      expect((await call('delete', `/${file.id}`, other, tenantA)).status).toBe(403);
      expect((await call('delete', `/${file.id}`, uploader, tenantA)).status).toBe(204);
      expect(removed).toContain(file.objectKey);

      const second = await uploaded(uploader, tenantA);
      const admin = await member(tenantA, 'admin');
      expect((await call('delete', `/${second.id}`, admin, tenantA)).status).toBe(204);
    });

    it('deletes nothing when storage fails, so the person can retry', async () => {
      const uploader = await member(tenantA, 'staff');
      const file = await uploaded(uploader, tenantA);
      storage.remove.mockRejectedValueOnce(new Error('storage down'));
      expect((await call('delete', `/${file.id}`, uploader, tenantA)).status).toBe(500);
      expect(await base.mediaFile.findUnique({ where: { id: file.id } })).not.toBeNull();
      expect((await call('delete', `/${file.id}`, uploader, tenantA)).status).toBe(204);
      expect(await base.mediaFile.findUnique({ where: { id: file.id } })).toBeNull();
    });

    it('does not let other staff confirm someone else’s upload', async () => {
      const uploader = await member(tenantA, 'staff');
      const file = await uploaded(uploader, tenantA);
      const other = await member(tenantA, 'staff');
      expect((await call('post', `/${file.id}/confirm`, other, tenantA)).status).toBe(403);
    });
  });

  describe('abandoned upload cleanup', () => {
    const job = () => app.get(MediaCleanupJob);

    describe('unattached files', () => {
      const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const file = (tenantId: string, uploadedByUserId: string, over: object = {}) =>
        base.mediaFile.create({
          data: {
            tenantId,
            uploadedByUserId,
            bucket: 'private_media',
            objectKey: `${tenantId}/payment_proof/${randomUUID()}.png`,
            purpose: 'payment_proof',
            mimeType: 'image/png',
            sizeBytes: 1,
            status: 'ready',
            createdAt: OLD,
            ...over,
          } as never,
        });
      const exists = async (id: string) =>
        (await base.mediaFile.findUnique({ where: { id } })) !== null;

      it('removes old unattached files in every tenant, and their stored objects', async () => {
        const [a, b] = [await member(tenantA, 'staff'), await member(tenantB, 'staff')];
        const proof = await file(tenantA, a);
        const receipt = await file(tenantB, b, { purpose: 'expense_receipt' });
        const sketch = await file(tenantA, a, { purpose: 'sketch' });
        await job().removeUnattachedFiles();
        for (const row of [proof, receipt, sketch]) {
          expect(await exists(row.id)).toBe(false);
          expect(removed).toContain(row.objectKey);
        }
      });

      it('keeps recent files, other kinds, and pending ones', async () => {
        const a = await member(tenantA, 'staff');
        const recent = await file(tenantA, a, { createdAt: new Date() });
        const photo = await file(tenantA, a, { purpose: 'fitting_photo' });
        const pending = await file(tenantA, a, { status: 'pending' });
        await job().removeUnattachedFiles();
        for (const row of [recent, photo, pending]) expect(await exists(row.id)).toBe(true);
      });

      it('keeps files attached to an expense, even a soft-deleted one', async () => {
        const a = await member(tenantA, 'owner');
        const kept = await file(tenantA, a, { purpose: 'expense_receipt' });
        const onDeleted = await file(tenantA, a, { purpose: 'expense_receipt' });
        const expense = (receiptMediaId: string, deletedAt: Date | null) =>
          base.expense.create({
            data: {
              tenantId: tenantA,
              kind: 'operating',
              category: 'Rent',
              amountCentavos: 1,
              incurredOn: new Date('2026-01-01'),
              receiptMediaId,
              recordedByUserId: a,
              deletedAt,
            },
          });
        await expense(kept.id, null);
        await expense(onDeleted.id, new Date());
        await job().removeUnattachedFiles();
        expect(await exists(kept.id)).toBe(true);
        expect(await exists(onDeleted.id)).toBe(true);
      });

      it('keeps the rows when storage fails, so the next run retries', async () => {
        const a = await member(tenantA, 'staff');
        const proof = await file(tenantA, a);
        storage.remove.mockRejectedValueOnce(new Error('storage down'));
        await job().removeUnattachedFiles();
        expect(await exists(proof.id)).toBe(true);
        await job().removeUnattachedFiles();
        expect(await exists(proof.id)).toBe(false);
      });
    });

    it('removes only expired pending files, in every tenant', async () => {
      const [a, b] = [await member(tenantA, 'staff'), await member(tenantB, 'staff')];
      const expiredA = await uploaded(a, tenantA);
      const expiredB = await uploaded(b, tenantB);
      const fresh = await uploaded(a, tenantA);
      const confirmed = await uploaded(a, tenantA);
      await call('post', `/${confirmed.id}/confirm`, a, tenantA);

      await base.mediaFile.updateMany({
        where: { id: { in: [expiredA.id, expiredB.id] } },
        data: { expiresAt: new Date('2020-01-01') },
      });

      await job().removeAbandonedUploads();

      expect(removed).toEqual(expect.arrayContaining([expiredA.objectKey, expiredB.objectKey]));
      expect(removed).not.toContain(fresh.objectKey);
      expect(removed).not.toContain(confirmed.objectKey);
      expect(await base.mediaFile.findUnique({ where: { id: expiredA.id } })).toBeNull();
      expect(await base.mediaFile.findUnique({ where: { id: fresh.id } })).not.toBeNull();
      expect(await base.mediaFile.findUnique({ where: { id: confirmed.id } })).not.toBeNull();
    });

    it('keeps the rows when storage fails, so the next run retries', async () => {
      const user = await member(tenantA, 'staff');
      const file = await uploaded(user, tenantA);
      await base.mediaFile.update({
        where: { id: file.id },
        data: { expiresAt: new Date('2020-01-01') },
      });
      storage.remove.mockRejectedValueOnce(new Error('storage down'));
      await job().removeAbandonedUploads();
      expect(await base.mediaFile.findUnique({ where: { id: file.id } })).not.toBeNull();
      await job().removeAbandonedUploads();
      expect(await base.mediaFile.findUnique({ where: { id: file.id } })).toBeNull();
    });
  });
});

describe('public site lookup', () => {
  let app: NestExpressApplication;
  let base: PrismaClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .setLogger(false as never)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, moduleRef.get<Env>(ENV));
    await app.init();
    base = moduleRef.get(BASE_PRISMA);
  });
  afterAll(() => app.close());

  const get = (slug: string) => request(app.getHttpServer()).get(`/api/v1/public/sites/${slug}`);

  it('returns only public fields, with no token', async () => {
    const slug = `s-${randomUUID().slice(0, 8)}`;
    await base.tenant.create({ data: { slug, name: 'Atelier' } });
    const res = await get(slug).expect(200);
    expect(res.body.data).toEqual({ slug, name: 'Atelier', available: true });
  });

  it.each(['suspended', 'inactive'] as const)('hides details of a %s tenant', async (status) => {
    const slug = `s-${randomUUID().slice(0, 8)}`;
    await base.tenant.create({ data: { slug, name: 'Hidden', status } });
    const res = await get(slug).expect(200);
    expect(res.body.data).toEqual({ slug, available: false });
  });

  it.each(['no-such-site', 'api', 'BAD', 'a%27b'])('returns 404 for %s', async (slug) => {
    await get(slug).expect(404);
  });
});
