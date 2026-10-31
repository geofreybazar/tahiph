import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';

describe('clients, projects and garments', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let staff: string;
  let outsider: string;

  const as = (user: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
    t.as(method, path, user, { tenant: user === outsider ? other : tenant, body });

  const newClient = async (fullName = 'Alma Santos', user = owner) =>
    (await as(user, 'post', '/clients', { fullName })).body.data;
  const newProject = async (clientId: string, user = owner) =>
    (await as(user, 'post', '/projects', { clientId, title: 'Santos wedding', priceCentavos: 15000050 }))
      .body.data;
  const garmentBody = { name: 'Gown', wearerName: 'Alma', wearerRole: 'bride' };
  const newGarment = async (projectId: string) =>
    (await as(owner, 'post', `/projects/${projectId}/garments`, garmentBody)).body.data;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    tenant = await t.createTenant();
    other = await t.createTenant();
    owner = (await t.createMember(tenant, 'owner')).userId;
    staff = (await t.createMember(tenant, 'staff')).userId;
    outsider = (await t.createMember(other, 'owner')).userId;
  });

  describe('clients', () => {
    it('creates with blanks as null, and normalizes email', async () => {
      const res = await as(staff, 'post', '/clients', {
        fullName: '  Bea Reyes ',
        email: 'BEA@Example.test',
        phone: '',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        fullName: 'Bea Reyes',
        email: 'bea@example.test',
        phone: null,
        tenantId: tenant,
      });
    });

    it.each([{ fullName: '' }, { fullName: 'x', email: 'nope' }, {}])('refuses %j', async (body) => {
      expect((await as(owner, 'post', '/clients', body)).status).toBe(400);
    });

    it('ignores a tenantId in the body', async () => {
      const res = await as(owner, 'post', '/clients', { fullName: 'x', tenantId: other });
      expect(res.body.data.tenantId).toBe(tenant);
    });

    it('searches, sorts and paginates', async () => {
      await newClient('Carla Dizon');
      await newClient('Ana Cruz');
      await newClient('Bea Cruz');
      const found = await as(owner, 'get', '/clients?q=cRuZ&sort=-fullName');
      expect(found.body.data.map((c: { fullName: string }) => c.fullName)).toEqual([
        'Bea Cruz',
        'Ana Cruz',
      ]);
      const paged = await as(owner, 'get', '/clients?limit=2&page=2');
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta).toMatchObject({ total: 3, totalPages: 2 });
      expect((await as(owner, 'get', '/clients?sort=tenantId')).status).toBe(400);
    });

    it('treats search text literally', async () => {
      await newClient('Ana');
      const res = await as(owner, 'get', `/clients?q=${encodeURIComponent("%' OR 1=1 --")}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('hides archived clients, for managers only to archive', async () => {
      const client = await newClient();
      expect((await as(staff, 'post', `/clients/${client.id}/archive`)).status).toBe(403);
      expect((await as(owner, 'post', `/clients/${client.id}/archive`)).status).toBe(200);
      expect((await as(owner, 'get', '/clients')).body.data).toEqual([]);
      expect((await as(owner, 'get', `/clients/${client.id}`)).status).toBe(200);
    });

    it('returns 404 across tenants, changing nothing', async () => {
      const client = await newClient();
      const path = `/clients/${client.id}`;
      expect((await as(outsider, 'get', path)).status).toBe(404);
      expect((await as(outsider, 'patch', path, { fullName: 'Hacked' })).status).toBe(404);
      expect((await as(outsider, 'post', `${path}/archive`)).status).toBe(404);
      expect((await as(outsider, 'get', '/clients')).body.data).toEqual([]);
      expect((await as(owner, 'get', path)).body.data.fullName).toBe('Alma Santos');
    });
  });

  describe('projects', () => {
    it('numbers per tenant and per Manila year', async () => {
      const client = await newClient();
      const first = await newProject(client.id);
      const second = await newProject(client.id);
      const year = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }).format();
      expect(first.projectNumber).toBe(`P-${year}-0001`);
      expect(second.projectNumber).toBe(`P-${year}-0002`);

      const theirClient = await newClient('Their', outsider);
      expect((await newProject(theirClient.id, outsider)).projectNumber).toBe(`P-${year}-0001`);
    });

    it('never repeats a number under concurrent creation', async () => {
      const client = await newClient();
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          as(owner, 'post', '/projects', { clientId: client.id, title: 't', priceCentavos: 1 }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
      const numbers = results.map((r) => r.body.data.projectNumber);
      expect(new Set(numbers).size).toBe(12);
    });

    it("refuses another tenant's client, and an archived one, with 404", async () => {
      const theirs = await newClient('Theirs', outsider);
      const res = await as(owner, 'post', '/projects', {
        clientId: theirs.id,
        title: 't',
        priceCentavos: 1,
      });
      expect(res.status).toBe(404);

      const client = await newClient();
      await as(owner, 'post', `/clients/${client.id}/archive`);
      const archived = await as(owner, 'post', '/projects', {
        clientId: client.id,
        title: 't',
        priceCentavos: 1,
      });
      expect(archived.status).toBe(404);
    });

    it('keeps the wedding date as a calendar day', async () => {
      const client = await newClient();
      const res = await as(owner, 'post', '/projects', {
        clientId: client.id,
        title: 't',
        priceCentavos: 1,
        weddingDate: '2027-02-14',
      });
      expect(res.body.data.weddingDate).toBe('2027-02-14');
      const got = await as(owner, 'get', `/projects/${res.body.data.id}`);
      expect(got.body.data.weddingDate).toBe('2027-02-14');
    });

    it.each([-1, 1.5, 2147483648, '100'])('refuses the price %j', async (priceCentavos) => {
      const client = await newClient();
      const res = await as(owner, 'post', '/projects', { clientId: client.id, title: 't', priceCentavos });
      expect(res.status).toBe(400);
    });

    it('lets staff see the price but not change it; a change is audited', async () => {
      const project = await newProject((await newClient()).id);
      const got = await as(staff, 'get', `/projects/${project.id}`);
      expect(got.body.data.priceCentavos).toBe(15000050);

      const path = `/projects/${project.id}/price`;
      expect((await as(staff, 'patch', path, { priceCentavos: 1 })).status).toBe(403);
      expect((await as(owner, 'patch', path, { priceCentavos: 2 })).body.data.priceCentavos).toBe(2);

      const log = await t.base.auditLog.findFirst({
        where: { tenantId: tenant, action: 'project.price_changed', entityId: project.id },
      });
      expect(log?.metadata).toEqual({ from: 15000050, to: 2 });
    });

    it('cannot change the price through the general update', async () => {
      const project = await newProject((await newClient()).id);
      await as(staff, 'patch', `/projects/${project.id}`, { title: 'New', priceCentavos: 1 });
      const got = await as(owner, 'get', `/projects/${project.id}`);
      expect(got.body.data).toMatchObject({ title: 'New', priceCentavos: 15000050 });
    });

    it('filters, searches by client name, and has no tenant-wide totals', async () => {
      const a = await newClient('Alma');
      const b = await newClient('Bea');
      const pa = await newProject(a.id);
      await newProject(b.id);
      await as(owner, 'post', `/projects/${pa.id}/status`, { status: 'active' });
      const active = await as(staff, 'get', '/projects?status=active');
      expect(active.body.data.map((p: { id: string }) => p.id)).toEqual([pa.id]);
      const named = await as(staff, 'get', '/projects?q=bea');
      expect(named.body.data[0].client.fullName).toBe('Bea');
      expect(Object.keys(named.body.meta).sort()).toEqual(['limit', 'page', 'total', 'totalPages']);
    });

    it('returns 404 across tenants, changing nothing', async () => {
      const project = await newProject((await newClient()).id);
      const path = `/projects/${project.id}`;
      expect((await as(outsider, 'get', path)).status).toBe(404);
      expect((await as(outsider, 'patch', path, { title: 'x' })).status).toBe(404);
      expect((await as(outsider, 'patch', `${path}/price`, { priceCentavos: 1 })).status).toBe(404);
      expect((await as(outsider, 'post', `${path}/status`, { status: 'cancelled' })).status).toBe(404);
      expect((await as(owner, 'get', path)).body.data.status).toBe('draft');
    });
  });

  describe('garments and production', () => {
    let project: { id: string };
    beforeEach(async () => {
      project = await newProject((await newClient()).id);
    });

    it('starts at Design, with a first history event', async () => {
      const garment = await newGarment(project.id);
      expect(garment.stage).toBe('design');
      const events = await as(owner, 'get', `/garments/${garment.id}/stage-events`);
      expect(events.body.data).toHaveLength(1);
      expect(events.body.data[0]).toMatchObject({ fromStage: null, toStage: 'design' });
    });

    it('moves forward and backward, recording everything', async () => {
      const garment = await newGarment(project.id);
      const move = (stage: string, note?: string) =>
        as(staff, 'post', `/garments/${garment.id}/stage`, { stage, note });
      expect((await move('fitting')).body.data.stage).toBe('fitting');
      expect((await move('alterations', 'Hem too long')).status).toBe(200);
      expect((await move('fitting')).status).toBe(200);
      const events = (await as(owner, 'get', `/garments/${garment.id}/stage-events`)).body.data;
      expect(events).toHaveLength(4);
      expect(events.find((e: { note: string }) => e.note === 'Hem too long')).toMatchObject({
        fromStage: 'fitting',
        toStage: 'alterations',
        changedBy: { email: `${staff}@example.test` },
      });
    });

    it('refuses a move to the same stage and an unknown stage', async () => {
      const garment = await newGarment(project.id);
      const path = `/garments/${garment.id}/stage`;
      expect((await as(owner, 'post', path, { stage: 'design' })).status).toBe(409);
      expect((await as(owner, 'post', path, { stage: 'burned' })).status).toBe(400);
    });

    it('records one move when two people move at once', async () => {
      const garment = await newGarment(project.id);
      const path = `/garments/${garment.id}/stage`;
      const results = await Promise.all([
        as(owner, 'post', path, { stage: 'cutting' }),
        as(staff, 'post', path, { stage: 'sewing' }),
      ]);
      const events = (await as(owner, 'get', `/garments/${garment.id}/stage-events`)).body.data;
      const ok = results.filter((r) => r.status === 200).length;
      expect(events).toHaveLength(1 + ok);
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      const latest = (await as(owner, 'get', `/garments/${garment.id}`)).body.data.stage;
      expect(events[0].toStage).toBe(latest);
    });

    it('shows a board by stage, without archived projects', async () => {
      const garment = await newGarment(project.id);
      await as(owner, 'post', `/garments/${garment.id}/stage`, { stage: 'sewing' });
      const board = await as(staff, 'get', '/garments?stage=sewing');
      expect(board.body.data[0]).toMatchObject({
        id: garment.id,
        project: { client: { fullName: 'Alma Santos' } },
      });
      await as(owner, 'post', `/projects/${project.id}/archive`);
      expect((await as(staff, 'get', '/garments?stage=sewing')).body.data).toEqual([]);
    });

    it('allows removal only before work starts, for managers', async () => {
      const garment = await newGarment(project.id);
      expect((await as(staff, 'delete', `/garments/${garment.id}`)).status).toBe(403);
      expect((await as(owner, 'delete', `/garments/${garment.id}`)).status).toBe(204);

      const started = await newGarment(project.id);
      await as(owner, 'post', `/garments/${started.id}/stage`, { stage: 'cutting' });
      expect((await as(owner, 'delete', `/garments/${started.id}`)).status).toBe(422);
    });

    it('refuses adding to an archived project', async () => {
      await as(owner, 'post', `/projects/${project.id}/archive`);
      const res = await as(owner, 'post', `/projects/${project.id}/garments`, garmentBody);
      expect(res.status).toBe(404);
    });

    it('returns 404 across tenants, changing nothing', async () => {
      const garment = await newGarment(project.id);
      const path = `/garments/${garment.id}`;
      expect((await as(outsider, 'post', `/projects/${project.id}/garments`, garmentBody)).status).toBe(404);
      expect((await as(outsider, 'get', path)).status).toBe(404);
      expect((await as(outsider, 'patch', path, garmentBody)).status).toBe(404);
      expect((await as(outsider, 'post', `${path}/stage`, { stage: 'ready' })).status).toBe(404);
      expect((await as(outsider, 'get', `${path}/stage-events`)).status).toBe(404);
      expect((await as(outsider, 'delete', path)).status).toBe(404);
      expect((await as(outsider, 'get', '/garments')).body.data).toEqual([]);
      expect((await as(owner, 'get', path)).body.data.stage).toBe('design');
    });

    it('returns 400 for a malformed id, not a 500', async () => {
      expect((await as(owner, 'get', '/garments/not-a-uuid')).status).toBe(400);
      expect((await as(owner, 'get', `/garments/${randomUUID()}`)).status).toBe(404);
    });
  });
});
