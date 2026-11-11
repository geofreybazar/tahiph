import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DatabaseClient } from '@tahi/database';
import { TENANT_PERMISSIONS } from '@tahi/types';
import { apiErrorSchema } from '@tahi/validation';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { SessionService } from '../src/core/auth/session.service.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { MAILER } from '../src/core/email/email.types.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { Browser } from './browser.js';
import { addMember, asTenant, createTenant, createUser, type TenantFixture } from './fixtures.js';

type App = Parameters<typeof request>[0];
type Json = Record<string, unknown>;
const code = (body: unknown) => apiErrorSchema.parse(body).error.code;
const data = (res: { body: unknown }) => (res.body as { data: Json }).data;
const page = (res: { body: unknown }) =>
  res.body as { data: Json[]; meta: { nextCursor: string | null; hasMore: boolean } };

describe('Clients (CRM) (integration)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let sessions: SessionService;
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
    return { b, membershipId: m.id };
  }

  const atelier = () =>
    createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      writer: ['clients.read', 'clients.write'],
      reader: ['clients.read'],
    });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [CoreModule, HttpModule, AuthCoreModule, AuditModule, AuthModule, ClientsModule],
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates, reads and updates a client; permissions apply', async () => {
    const t = await atelier();
    const writer = await member(t, 'writer');
    const reader = await member(t, 'reader');
    const created = await writer.b.post('tenant/clients', {
      firstName: 'Ana',
      lastName: 'Cruz',
      email: 'Ana@Example.test',
      birthday: '1995-04-20',
      tags: ['Bride'],
      source: 'REFERRAL',
    });
    expect(created.status).toBe(201);
    expect(data(created)).toMatchObject({
      firstName: 'Ana',
      email: 'ana@example.test',
      birthday: '1995-04-20',
      tags: ['bride'],
      archivedAt: null,
    });
    expect(data(created)).not.toHaveProperty('tenantId');
    const id = data(created).id as string;

    const updated = await writer.b.send('patch', `tenant/clients/${id}`, {
      phone: '+63 917 000 0000',
      birthday: null,
    });
    expect(data(updated)).toMatchObject({
      phone: '+63 917 000 0000',
      birthday: null,
      lastName: 'Cruz',
    });
    expect(data(await reader.b.get(`tenant/clients/${id}`))).toMatchObject({ firstName: 'Ana' });
    expect((await reader.b.post('tenant/clients', { firstName: 'X' })).status).toBe(403);
    expect((await writer.b.post(`tenant/clients/${id}/archive`)).status).toBe(403);
    expect((await writer.b.get('tenant/clients/0190c0de-0000-7000-8000-000000000001')).status).toBe(
      404,
    );
  });

  it('searches, filters by tag and pages newest first', async () => {
    const t = await atelier();
    const { b } = await member(t, 'writer');
    for (const [firstName, lastName, phone, tags] of [
      ['Maria', 'Santos', '0917-111-2222', ['bride']],
      ['Jose', 'Rizal', '0918-333-4444', []],
      ['Mariel', 'Reyes', null, ['bride', 'vip']],
    ] as const) {
      await b.post('tenant/clients', { firstName, lastName, phone, tags: [...tags] });
    }
    const names = (res: { body: unknown }) => page(res).data.map((c) => c.firstName);
    expect(names(await b.get('tenant/clients?q=mari'))).toEqual(['Mariel', 'Maria']);
    expect(names(await b.get('tenant/clients?q=333'))).toEqual(['Jose']);
    expect(names(await b.get('tenant/clients?q=REYES'))).toEqual(['Mariel']);
    expect(names(await b.get('tenant/clients?tag=VIP'))).toEqual(['Mariel']);

    const first = page(await b.get('tenant/clients?limit=2'));
    expect(first.data.map((c) => c.firstName)).toEqual(['Mariel', 'Jose']);
    expect(first.meta.hasMore).toBe(true);
    const second = page(
      await b.get(`tenant/clients?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor!)}`),
    );
    expect(second.data.map((c) => c.firstName)).toEqual(['Maria']);
    expect(second.meta).toEqual({ hasMore: false, nextCursor: null });

    const bad = await b.get('tenant/clients?cursor=nope');
    expect([bad.status, code(bad.body)]).toEqual([422, 'VALIDATION_FAILED']);
  });

  it('archives and restores, hiding archived clients by default', async () => {
    const t = await atelier();
    const { b } = await member(t, 'owner');
    const id = data(await b.post('tenant/clients', { firstName: 'Lea' })).id as string;
    const archived = await b.post(`tenant/clients/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(data(archived).archivedAt).not.toBeNull();
    // Idempotent.
    expect((await b.post(`tenant/clients/${id}/archive`)).status).toBe(200);
    expect(page(await b.get('tenant/clients')).data).toEqual([]);
    expect(page(await b.get('tenant/clients?status=archived')).data).toHaveLength(1);
    expect(page(await b.get('tenant/clients?status=all')).data).toHaveLength(1);
    expect(data(await b.post(`tenant/clients/${id}/restore`)).archivedAt).toBeNull();
    const actions = await asTenant(prisma, t.tenantId, async (tx) =>
      (await tx.tenantAuditLog.findMany({ select: { action: true } })).map((a) => a.action),
    );
    expect(actions.filter((a) => a === 'client.archived')).toHaveLength(1);
    expect(actions).toContain('client.restored');
  });

  it('keeps notes; only the author deletes, and only under the right client', async () => {
    const t = await atelier();
    const author = await member(t, 'writer');
    const other = await member(t, 'owner');
    const ana = data(await author.b.post('tenant/clients', { firstName: 'Ana' })).id as string;
    const bea = data(await author.b.post('tenant/clients', { firstName: 'Bea' })).id as string;
    const note = await author.b.post(`tenant/clients/${ana}/notes`, { body: 'Prefers silk' });
    expect(note.status).toBe(201);
    expect(data(note)).toMatchObject({
      body: 'Prefers silk',
      author: { membershipId: author.membershipId, name: 'Test User' },
    });
    const noteId = data(note).id as string;
    const list = await other.b.get(`tenant/clients/${ana}/notes`);
    expect((list.body as { data: Json[] }).data.map((n) => n.id)).toEqual([noteId]);

    // A note id of one client under another client is not found.
    expect((await author.b.send('delete', `tenant/clients/${bea}/notes/${noteId}`)).status).toBe(
      404,
    );
    const notAuthor = await other.b.send('delete', `tenant/clients/${ana}/notes/${noteId}`);
    expect([notAuthor.status, code(notAuthor.body)]).toEqual([403, 'NOT_NOTE_AUTHOR']);
    expect((await author.b.send('delete', `tenant/clients/${ana}/notes/${noteId}`)).status).toBe(
      204,
    );
    expect((await other.b.get(`tenant/clients/${ana}/notes`)).body).toEqual({ data: [] });
  });

  it('logs communications newest first', async () => {
    const t = await atelier();
    const { b, membershipId } = await member(t, 'writer');
    const id = data(await b.post('tenant/clients', { firstName: 'Ana' })).id as string;
    await b.post(`tenant/clients/${id}/communications`, {
      channel: 'CALL',
      direction: 'INBOUND',
      summary: 'Asked about fittings',
      occurredAt: '2026-11-10T09:30:00+08:00',
    });
    const latest = await b.post(`tenant/clients/${id}/communications`, {
      channel: 'VIBER',
      direction: 'OUTBOUND',
      summary: 'Sent fabric photos',
    });
    expect(data(latest)).toMatchObject({ channel: 'VIBER', recordedBy: { membershipId } });
    const list = (await b.get(`tenant/clients/${id}/communications`)).body as { data: Json[] };
    expect(list.data.map((c) => c.channel)).toEqual(['VIBER', 'CALL']);
    expect(list.data[1]!.occurredAt).toBe('2026-11-10T01:30:00.000Z');
  });
});
