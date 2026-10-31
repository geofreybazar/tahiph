import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';

describe('appointments', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let staff: string;
  let outsider: string;
  let client: { id: string };
  let project: { id: string };
  let garment: { id: string };

  const as = (user: string, method: 'get' | 'post' | 'patch', url: string, body?: object) =>
    t.as(method, url, user, { tenant: user === outsider ? other : tenant, body });
  const times = { startsAt: '2027-01-15T02:00:00.000Z', endsAt: '2027-01-15T03:00:00.000Z' };
  const fitting = { type: 'fitting', ...times };
  const make = async (user = staff, body: object = fitting) =>
    (await as(user, 'post', '/appointments', body)).body.data;
  const newClient = async (user = owner, fullName = 'Alma') =>
    (await as(user, 'post', '/clients', { fullName })).body.data;
  const newProject = async (clientId: string, user = owner) =>
    (await as(user, 'post', '/projects', { clientId, title: 't', priceCentavos: 15000050 })).body
      .data;
  const newGarment = async (projectId: string, user = owner) =>
    (
      await as(user, 'post', `/projects/${projectId}/garments`, {
        name: 'Gown',
        wearerName: 'Alma',
        wearerRole: 'bride',
      })
    ).body.data;

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
    client = await newClient();
    project = await newProject(client.id);
    garment = await newGarment(project.id);
  });

  it('creates as scheduled, with exact moments, ignoring tenant and status in the body', async () => {
    const res = await as(staff, 'post', '/appointments', {
      ...fitting,
      location: 'Studio',
      status: 'completed',
      tenantId: other,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ...times,
      status: 'scheduled',
      location: 'Studio',
      tenantId: tenant,
      clientId: null,
    });
  });

  it('keeps a moment given in Manila time', async () => {
    const made = await make(staff, {
      type: 'pickup',
      startsAt: '2027-01-15T00:30:00+08:00',
      endsAt: '2027-01-15T01:00:00+08:00',
    });
    expect(made.startsAt).toBe('2027-01-14T16:30:00.000Z');
  });

  it.each([
    ['an unknown type', { ...fitting, type: 'party' }],
    ['no start', { type: 'fitting', endsAt: times.endsAt }],
    ['a day with no time', { ...fitting, startsAt: '2027-01-15' }],
    ['an end before the start', { ...fitting, startsAt: times.endsAt, endsAt: times.startsAt }],
    ['an end equal to the start', { ...fitting, endsAt: times.startsAt }],
    ['a bad client id', { ...fitting, clientId: 'nope' }],
  ])('refuses %s', async (_name, body) => {
    expect((await as(owner, 'post', '/appointments', body)).status).toBe(400);
  });

  it('the database refuses an end before the start', async () => {
    const made = await make();
    await expect(
      t.base.appointment.update({
        where: { id: made.id },
        data: { endsAt: new Date(times.startsAt) },
      }),
    ).rejects.toThrow();
  });

  describe('links', () => {
    it('fills in the project and client from a garment', async () => {
      const made = await make(staff, { ...fitting, garmentId: garment.id });
      expect(made).toMatchObject({
        garmentId: garment.id,
        projectId: project.id,
        clientId: client.id,
        client: { fullName: 'Alma' },
        garment: { name: 'Gown' },
      });
    });

    it('shows no money to anyone through the link', async () => {
      const made = await make(staff, { ...fitting, projectId: project.id });
      expect(JSON.stringify(made)).not.toContain('price');
    });

    it('fills in the client from a project', async () => {
      const made = await make(staff, { ...fitting, projectId: project.id });
      expect(made.clientId).toBe(client.id);
    });

    it('refuses links that disagree', async () => {
      const second = await newClient(owner, 'Bea');
      const secondProject = await newProject(second.id);
      const post = (body: object) => as(owner, 'post', '/appointments', { ...fitting, ...body });
      expect((await post({ clientId: second.id, projectId: project.id })).status).toBe(422);
      expect((await post({ projectId: secondProject.id, garmentId: garment.id })).status).toBe(422);
      expect((await post({ clientId: second.id, garmentId: garment.id })).status).toBe(422);
    });

    it('refuses new links to archived records, but keeps existing ones when edited', async () => {
      const made = await make(staff, { ...fitting, projectId: project.id });
      await as(owner, 'post', `/projects/${project.id}/archive`);
      expect(
        (await as(owner, 'post', '/appointments', { ...fitting, projectId: project.id })).status,
      ).toBe(404);
      const edited = await as(owner, 'patch', `/appointments/${made.id}`, {
        ...fitting,
        clientId: client.id,
        projectId: project.id,
        notes: 'Moved',
      });
      expect(edited.body.data).toMatchObject({ notes: 'Moved', projectId: project.id });

      await as(owner, 'post', `/clients/${client.id}/archive`);
      expect(
        (await as(owner, 'post', '/appointments', { ...fitting, clientId: client.id })).status,
      ).toBe(404);
    });

    it('can clear links on edit', async () => {
      const made = await make(staff, { ...fitting, garmentId: garment.id });
      const res = await as(owner, 'patch', `/appointments/${made.id}`, fitting);
      expect(res.body.data).toMatchObject({ clientId: null, projectId: null, garmentId: null });
    });

    it("refuses another tenant's records; the database does too", async () => {
      const theirClient = await newClient(outsider, 'Out');
      const theirProject = await newProject(theirClient.id, outsider);
      const theirGarment = await newGarment(theirProject.id, outsider);
      for (const body of [
        { clientId: theirClient.id },
        { projectId: theirProject.id },
        { garmentId: theirGarment.id },
      ]) {
        expect((await as(owner, 'post', '/appointments', { ...fitting, ...body })).status).toBe(
          404,
        );
      }
      const made = await make();
      await expect(
        t.base.appointment.update({ where: { id: made.id }, data: { clientId: theirClient.id } }),
      ).rejects.toThrow();
    });
  });

  describe('status', () => {
    it.each(['completed', 'cancelled', 'no_show'])('staff can mark %s', async (status) => {
      const made = await make();
      const res = await as(staff, 'post', `/appointments/${made.id}/status`, { status });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    });

    it('refuses an unknown status, and edits unless scheduled; a mistake can be undone', async () => {
      const made = await make();
      const path = `/appointments/${made.id}`;
      expect((await as(owner, 'post', `${path}/status`, { status: 'lost' })).status).toBe(400);
      await as(owner, 'post', `${path}/status`, { status: 'cancelled' });
      expect((await as(owner, 'patch', path, { ...fitting, notes: 'x' })).status).toBe(422);
      await as(owner, 'post', `${path}/status`, { status: 'scheduled' });
      expect((await as(owner, 'patch', path, { ...fitting, notes: 'x' })).body.data.notes).toBe(
        'x',
      );
    });
  });

  describe('lists', () => {
    it('filters by Manila calendar days, soonest first', async () => {
      const at = (startsAt: string) =>
        make(owner, {
          type: 'other',
          startsAt,
          endsAt: new Date(new Date(startsAt).getTime() + 1800000).toISOString(),
        });
      // Manila is UTC+8, so the 15th there runs from 16:00 UTC on the 14th to 15:59 UTC on the 15th.
      await at('2027-01-14T15:59:00.000Z');
      const last = await at('2027-01-15T15:59:00.000Z');
      const first = await at('2027-01-14T16:00:00.000Z');
      await at('2027-01-15T16:00:00.000Z');
      const res = await as(staff, 'get', '/appointments?from=2027-01-15&to=2027-01-15');
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([first.id, last.id]);
    });

    it('filters by client, project and garment', async () => {
      const made = await make(staff, { ...fitting, garmentId: garment.id });
      await make();
      for (const query of [
        `clientId=${client.id}`,
        `projectId=${project.id}`,
        `garmentId=${garment.id}`,
      ]) {
        const res = await as(staff, 'get', `/appointments?${query}`);
        expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([made.id]);
      }
    });
  });

  it('returns 404 across tenants, changing nothing', async () => {
    const made = await make();
    const path = `/appointments/${made.id}`;
    expect((await as(outsider, 'get', path)).status).toBe(404);
    expect((await as(outsider, 'patch', path, { ...fitting, notes: 'Hacked' })).status).toBe(404);
    expect((await as(outsider, 'post', `${path}/status`, { status: 'cancelled' })).status).toBe(
      404,
    );
    expect((await as(outsider, 'get', '/appointments')).body.data).toEqual([]);
    expect((await as(owner, 'get', path)).body.data).toMatchObject({
      status: 'scheduled',
      notes: null,
    });
  });

  it('returns 400 for a malformed id, and 404 for an unknown one', async () => {
    expect((await as(owner, 'get', '/appointments/not-a-uuid')).status).toBe(400);
    expect((await as(owner, 'get', `/appointments/${randomUUID()}`)).status).toBe(404);
  });
});
