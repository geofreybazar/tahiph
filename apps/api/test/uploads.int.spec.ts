import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { TENANT_PERMISSIONS } from '@tahi/types';
import { apiErrorSchema } from '@tahi/validation';
import sharp from 'sharp';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { SessionService } from '../src/core/auth/session.service.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { MAILER } from '../src/core/email/email.types.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { StorageService } from '../src/core/storage/storage.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { mediaKeys } from '../src/modules/uploads/media.js';
import { UploadsModule, UploadsWorkerModule } from '../src/modules/uploads/uploads.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
type Upload = { asset: Json; upload: { url: string; headers: Record<string, string> } };
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = <T = Json>(res: { body: unknown }) => (res.body as { data: T }).data;

const jpegWithGps = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#7a1f3d' } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 35/1 0/1' } })
    .toBuffer();

/** Uploads end to end against real storage (RustFS) and the real media queue + processor. */
describe('Uploads (integration)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let sessions: SessionService;
  let storage: StorageService;
  const server = (): App => app.getHttpServer() as App;

  async function member(t: TenantFixture, roleKey: string) {
    const user = await createUser(prisma);
    const m = await addMember(prisma, t, user.id, roleKey);
    const s = await sessions.create({
      realm: 'TENANT',
      subjectId: user.id,
      tenantId: t.tenantId,
      activeMembershipId: m.id,
    });
    const b = new Browser(server, 'app.tahi.test');
    b.cookies.set('__Host-tahi_app', s.token);
    return b;
  }

  async function setup() {
    const t = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      reader: ['catalog.read'],
    });
    const item = await asTenant(prisma, t.tenantId, (tx) =>
      tx.catalogItem.create({
        data: { tenantId: t.tenantId, kind: 'PRODUCT', name: 'Terno', pricingMode: 'QUOTE' },
      }),
    );
    const images = `tenant/catalog/items/${item.id}/images`;
    return { t, images, b: await member(t, 'owner'), reader: await member(t, 'reader') };
  }

  const put = (u: Upload, body: Buffer, contentType = u.upload.headers['Content-Type']!) =>
    fetch(u.upload.url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType },
    });

  /** Waits for the worker to finish the asset (READY or REJECTED). */
  async function settled(b: Browser, list: string, id: string) {
    for (let i = 0; i < 100; i++) {
      const res = await b.get(list);
      const one = [data<Json[]>(res)].flat().find((a) => a?.id === id);
      if (one && one.status !== 'PROCESSING') return one;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`asset ${id} never settled`);
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [
        CoreModule,
        HttpModule,
        AuthCoreModule,
        AuditModule,
        AuthModule,
        UploadsModule,
        UploadsWorkerModule,
      ],
    })
      .overrideProvider(MAILER)
      .useValue({ send: () => Promise.resolve() })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore())
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
    sessions = app.get(SessionService);
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads, verifies and re-encodes a catalogue image without its metadata', async () => {
    const { t, b, images } = await setup();
    const original = await jpegWithGps();
    const created = await b.post(images, { contentType: 'image/jpeg', size: original.length });
    expect(created.status).toBe(201);
    const u = data<Upload>(created);
    expect(u.asset).toMatchObject({ status: 'PENDING', purpose: 'CATALOG_ITEM_IMAGE', urls: null });
    expect(u.upload.url).toContain(`pending/${t.tenantId}/`);
    expect((await put(u, original)).status).toBe(200);

    const confirmed = await b.post(`${images}/${u.asset.id as string}/confirm`, {});
    expect(confirmed.status).toBe(200);
    expect(data(confirmed).status).toMatch(/PROCESSING|READY/);

    const ready = await settled(b, images, u.asset.id as string);
    expect(ready).toMatchObject({ status: 'READY', width: 1200, height: 800 });
    const urls = ready.urls as { display: string; thumb: string };
    const display = Buffer.from(await (await fetch(urls.display)).arrayBuffer());
    const meta = await sharp(display).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1200 });
    expect(meta.exif).toBeUndefined();
    expect(
      (await sharp(Buffer.from(await (await fetch(urls.thumb)).arrayBuffer())).metadata()).width,
    ).toBe(400);
    // The original (with GPS) is gone.
    expect(await storage.head(mediaKeys(t.tenantId, u.asset.id as string).pending)).toBeNull();

    // Confirming again is harmless.
    expect(data(await b.post(`${images}/${u.asset.id as string}/confirm`, {})).status).toBe(
      'READY',
    );
  });

  it('refuses to confirm before the file arrives, and rejects mismatched files', async () => {
    const { b, images } = await setup();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();

    const early = data<Upload>(
      await b.post(images, { contentType: 'image/png', size: png.length }),
    );
    const res = await b.post(`${images}/${early.asset.id as string}/confirm`, {});
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('UPLOAD_NOT_RECEIVED');

    // Stored with a different type than declared (storage may not enforce the signed type).
    const wrongHeader = data<Upload>(
      await b.post(images, { contentType: 'image/png', size: png.length }),
    );
    await put(wrongHeader, png, 'image/jpeg');
    const rejected = data(await b.post(`${images}/${wrongHeader.asset.id as string}/confirm`, {}));
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'file type does not match the upload',
    });

    // Declared JPEG, header JPEG, but the bytes are PNG: the worker reads the bytes.
    const disguised = data<Upload>(
      await b.post(images, { contentType: 'image/jpeg', size: png.length }),
    );
    await put(disguised, png);
    await b.post(`${images}/${disguised.asset.id as string}/confirm`, {});
    expect(await settled(b, images, disguised.asset.id as string)).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'file content does not match its declared type',
    });
  });

  it('validates the request and enforces permissions', async () => {
    const { b, reader, images } = await setup();
    const tooBig = await b.post(images, { contentType: 'image/jpeg', size: 10 * 1024 * 1024 + 1 });
    expect(tooBig.status).toBe(422);
    const heic = await b.post(images, { contentType: 'image/heic', size: 100 });
    expect(heic.status).toBe(422);
    expect((await reader.get(images)).status).toBe(200);
    expect((await reader.post(images, { contentType: 'image/png', size: 100 })).status).toBe(403);
    expect(
      (await reader.post('tenant/settings/logo', { contentType: 'image/png', size: 100 })).status,
    ).toBe(403);
    expect((await reader.get('tenant/settings/logo')).status).toBe(200);
  });

  it('keeps one logo: a new ready logo replaces the old one', async () => {
    const { t, b } = await setup();
    expect(data(await b.get('tenant/settings/logo'))).toBeNull();
    const logo = async () => {
      const bytes = await sharp({
        create: { width: 300, height: 100, channels: 4, background: '#0000' },
      })
        .png()
        .toBuffer();
      const u = data<Upload>(
        await b.post('tenant/settings/logo', { contentType: 'image/png', size: bytes.length }),
      );
      await put(u, bytes);
      await b.post(`tenant/settings/logo/${u.asset.id as string}/confirm`, {});
      for (let i = 0; i < 100; i++) {
        const current = data<Json | null>(await b.get('tenant/settings/logo'));
        if (current?.id === u.asset.id) return u.asset.id as string;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('logo never became current');
    };
    const first = await logo();
    const second = await logo();
    // The worker removes the old logo just after marking the new one ready.
    const logoIds = async () =>
      (
        await asTenant(prisma, t.tenantId, (tx) =>
          tx.mediaAsset.findMany({ where: { purpose: 'LOGO' }, select: { id: true } }),
        )
      ).map((r) => r.id);
    for (let i = 0; i < 50 && (await logoIds()).length > 1; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await logoIds()).toEqual([second]);
    expect(await storage.head(mediaKeys(t.tenantId, first).display)).toBeNull();

    const del = await b.send('delete', `tenant/settings/logo/${second}`, {});
    expect(del.status).toBe(204);
    expect(data(await b.get('tenant/settings/logo'))).toBeNull();
    expect(await storage.head(mediaKeys(t.tenantId, second).display)).toBeNull();
  });
});
