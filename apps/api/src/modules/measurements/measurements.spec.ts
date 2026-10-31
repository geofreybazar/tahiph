import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';

describe('measurements', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let staff: string;
  let outsider: string;
  let client: { id: string };
  let profile: { id: string };

  const as = (
    user: string,
    method: 'get' | 'post' | 'patch' | 'delete' | 'put',
    path: string,
    body?: object,
  ) => t.as(method as 'get', path, user, { tenant: user === outsider ? other : tenant, body });
  const record = {
    takenOn: '2027-01-15',
    unit: 'in',
    values: [
      { key: 'bust', value: '34.50' },
      { key: 'waist', value: '26' },
    ],
  };
  const addRecord = async (user = staff, body: object = record, profileId = profile.id) =>
    as(user, 'post', `/measurement-profiles/${profileId}/records`, body);

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
    client = (await as(owner, 'post', '/clients', { fullName: 'Alma' })).body.data;
    profile = (
      await as(staff, 'post', `/clients/${client.id}/measurement-profiles`, {
        personName: 'Maid of honor',
      })
    ).body.data;
  });

  it('keeps values as typed decimal strings, in the unit entered, with who took them', async () => {
    const res = await addRecord();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      takenOn: '2027-01-15',
      unit: 'in',
      recordedBy: { email: `${staff}@example.test` },
    });
    expect(
      res.body.data.values.map((v: { key: string; value: string }) => [v.key, v.value]),
    ).toEqual([
      ['bust', '34.50'],
      ['waist', '26.00'],
    ]);
  });

  it.each([
    ['no values', { ...record, values: [] }],
    ['zero', { ...record, values: [{ key: 'bust', value: '0' }] }],
    ['negative', { ...record, values: [{ key: 'bust', value: '-1' }] }],
    ['too precise', { ...record, values: [{ key: 'bust', value: '1.234' }] }],
    ['too big', { ...record, values: [{ key: 'bust', value: '12345' }] }],
    ['a number', { ...record, values: [{ key: 'bust', value: 34 }] }],
    [
      'repeated',
      {
        ...record,
        values: [
          { key: 'bust', value: '1' },
          { key: 'bust', value: '2' },
        ],
      },
    ],
    ['unnamed custom', { ...record, values: [{ key: 'custom_1', value: '1' }] }],
    ['bad unit', { ...record, unit: 'ft' }],
    ['bad date', { ...record, takenOn: '15/01/2027' }],
  ])('refuses %s', async (_name, body) => {
    expect((await addRecord(owner, body)).status).toBe(400);
  });

  it('accepts a named custom measurement', async () => {
    const res = await addRecord(owner, {
      ...record,
      values: [{ key: 'custom_1', label: 'Train length', value: '60' }],
    });
    expect(res.body.data.values[0]).toMatchObject({ label: 'Train length', value: '60.00' });
  });

  it('keeps every fitting as history, newest first, with no way to edit one', async () => {
    const first = (await addRecord()).body.data;
    await addRecord(owner, { ...record, takenOn: '2027-02-20' });
    const got = (await as(staff, 'get', `/measurement-profiles/${profile.id}`)).body.data;
    expect(got.records.map((r: { takenOn: string }) => r.takenOn)).toEqual([
      '2027-02-20',
      '2027-01-15',
    ]);

    const path = `/measurement-records/${first.id}`;
    expect((await as(owner, 'patch', path, { unit: 'cm' })).status).toBe(404);
    expect((await as(owner, 'delete', path)).status).toBe(404);
    expect((await as(owner, 'get', path)).body.data.unit).toBe('in');
  });

  it('allows a profile for someone who is not a client, renames it, and lists it', async () => {
    const path = `/measurement-profiles/${profile.id}`;
    expect((await as(staff, 'patch', path, { personName: 'Ninang' })).body.data.personName).toBe(
      'Ninang',
    );
    await addRecord();
    const list = (await as(staff, 'get', `/clients/${client.id}/measurement-profiles`)).body.data;
    expect(list[0]).toMatchObject({ personName: 'Ninang', records: [{ takenOn: '2027-01-15' }] });
    expect(list[0].records[0].values).toBeUndefined();
  });

  it('refuses a new profile for an archived client', async () => {
    await as(owner, 'post', `/clients/${client.id}/archive`);
    const res = await as(owner, 'post', `/clients/${client.id}/measurement-profiles`, {
      personName: 'x',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 across tenants, changing nothing', async () => {
    const made = (await addRecord()).body.data;
    const path = `/measurement-profiles/${profile.id}`;
    expect((await as(outsider, 'get', `/clients/${client.id}/measurement-profiles`)).status).toBe(
      404,
    );
    expect(
      (
        await as(outsider, 'post', `/clients/${client.id}/measurement-profiles`, {
          personName: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await as(outsider, 'get', path)).status).toBe(404);
    expect((await as(outsider, 'patch', path, { personName: 'Hacked' })).status).toBe(404);
    expect((await addRecord(outsider)).status).toBe(404);
    expect((await as(outsider, 'get', `/measurement-records/${made.id}`)).status).toBe(404);
    const got = (await as(owner, 'get', path)).body.data;
    expect(got.personName).toBe('Maid of honor');
    expect(got.records).toHaveLength(1);
  });

  describe('assigned to a garment', () => {
    let garment: { id: string };
    let made: { id: string };
    const newProject = async (clientId: string, user = owner) =>
      (await as(user, 'post', '/projects', { clientId, title: 't', priceCentavos: 1 })).body.data;
    const body = { name: 'Gown', wearerName: 'Alma', wearerRole: 'bride' };

    beforeEach(async () => {
      made = (await addRecord()).body.data;
      const project = await newProject(client.id);
      garment = (await as(owner, 'post', `/projects/${project.id}/garments`, body)).body.data;
    });

    it('assigns, leaves it alone when omitted, and clears on null', async () => {
      const path = `/garments/${garment.id}`;
      const assigned = await as(staff, 'patch', path, { ...body, measurementRecordId: made.id });
      expect(assigned.body.data.measurementRecordId).toBe(made.id);
      expect((await as(staff, 'patch', path, body)).body.data.measurementRecordId).toBe(made.id);
      const cleared = await as(staff, 'patch', path, { ...body, measurementRecordId: null });
      expect(cleared.body.data.measurementRecordId).toBeNull();
    });

    it("refuses another client's and another tenant's record", async () => {
      const path = `/garments/${garment.id}`;
      const second = (await as(owner, 'post', '/clients', { fullName: 'Bea' })).body.data;
      const theirProfile = (
        await as(owner, 'post', `/clients/${second.id}/measurement-profiles`, { personName: 'Bea' })
      ).body.data;
      const wrong = (await addRecord(owner, record, theirProfile.id)).body.data;
      expect(
        (await as(owner, 'patch', path, { ...body, measurementRecordId: wrong.id })).status,
      ).toBe(404);

      const outClient = (await as(outsider, 'post', '/clients', { fullName: 'Out' })).body.data;
      const outProfile = (
        await as(outsider, 'post', `/clients/${outClient.id}/measurement-profiles`, {
          personName: 'Out',
        })
      ).body.data;
      const foreign = (await addRecord(outsider, record, outProfile.id)).body.data;
      expect(
        (await as(owner, 'patch', path, { ...body, measurementRecordId: foreign.id })).status,
      ).toBe(404);
    });

    it('is blocked by the composite foreign key even if the API is bypassed', async () => {
      const outClient = (await as(outsider, 'post', '/clients', { fullName: 'Out' })).body.data;
      const outProfile = (
        await as(outsider, 'post', `/clients/${outClient.id}/measurement-profiles`, {
          personName: 'Out',
        })
      ).body.data;
      const foreign = (await addRecord(outsider, record, outProfile.id)).body.data;
      await expect(
        t.base.garment.update({
          where: { id: garment.id },
          data: { measurementRecordId: foreign.id },
        }),
      ).rejects.toThrow();
    });
  });

  describe('routes by parent', () => {
    it('lists projects by client and garments by project, 404 across tenants', async () => {
      const project = (
        await as(owner, 'post', '/projects', { clientId: client.id, title: 't', priceCentavos: 1 })
      ).body.data;
      await as(owner, 'post', `/projects/${project.id}/garments`, {
        name: 'G',
        wearerName: 'A',
        wearerRole: 'bride',
      });
      const projects = await as(staff, 'get', `/clients/${client.id}/projects`);
      expect(projects.body.data.map((p: { id: string }) => p.id)).toEqual([project.id]);
      const garments = await as(staff, 'get', `/projects/${project.id}/garments`);
      expect(garments.body.data).toHaveLength(1);
      expect((await as(outsider, 'get', `/clients/${client.id}/projects`)).status).toBe(404);
      expect((await as(outsider, 'get', `/projects/${project.id}/garments`)).status).toBe(404);
    });
  });
});
