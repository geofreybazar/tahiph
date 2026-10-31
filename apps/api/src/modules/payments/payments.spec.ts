import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';

describe('payment schedule', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let outsider: string;
  let project: { id: string };
  let path: string;

  const as = (user: string, method: 'get' | 'put' | 'post', url: string, body?: object) =>
    t.as(method as 'get', url, user, { tenant: user === outsider ? other : tenant, body });
  const deposit = { label: 'Deposit', dueDate: '2027-01-15', amountCentavos: 5000050 };
  const balance = { label: 'Balance', dueDate: '2027-02-01', amountCentavos: 10000000 };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    tenant = await t.createTenant();
    other = await t.createTenant();
    owner = (await t.createMember(tenant, 'owner')).userId;
    admin = (await t.createMember(tenant, 'admin')).userId;
    staff = (await t.createMember(tenant, 'staff')).userId;
    outsider = (await t.createMember(other, 'owner')).userId;
    const client = (await as(owner, 'post', '/clients', { fullName: 'Alma' })).body.data;
    project = (
      await as(owner, 'post', '/projects', {
        clientId: client.id,
        title: 't',
        priceCentavos: 15000050,
      })
    ).body.data;
    path = `/projects/${project.id}/payment-schedule`;
  });

  it('saves in the order given, with calendar days and exact totals', async () => {
    const res = await as(admin, 'put', path, { items: [balance, deposit] });
    expect(res.status).toBe(200);
    expect(
      res.body.data.items.map((i: { label: string; dueDate: string }) => [i.label, i.dueDate]),
    ).toEqual([
      ['Balance', '2027-02-01'],
      ['Deposit', '2027-01-15'],
    ]);
    expect(res.body.data).toMatchObject({
      totalCentavos: 15000050,
      priceCentavos: 15000050,
      differenceCentavos: 0,
    });
  });

  it('reports a mismatch with the price without refusing it, and follows a price change', async () => {
    await as(owner, 'put', path, { items: [deposit] });
    await as(owner, 'patch' as 'put', `/projects/${project.id}/price`, { priceCentavos: 5000000 });
    const got = (await as(staff, 'get', path)).body.data;
    expect(got.differenceCentavos).toBe(-50);
  });

  it('keeps the ids of items sent back, and replaces the rest', async () => {
    const first = (await as(owner, 'put', path, { items: [deposit, balance] })).body.data.items;
    const next = await as(owner, 'put', path, {
      items: [
        { ...deposit, id: first[0].id, amountCentavos: 1 },
        { ...balance, label: 'Final' },
      ],
    });
    expect(next.body.data.items[0]).toMatchObject({ id: first[0].id, amountCentavos: 1 });
    expect(next.body.data.items[1].id).not.toBe(first[1].id);
    expect(next.body.data.items).toHaveLength(2);
  });

  it('can be emptied', async () => {
    await as(owner, 'put', path, { items: [deposit] });
    expect((await as(owner, 'put', path, { items: [] })).body.data).toMatchObject({
      items: [],
      totalCentavos: 0,
    });
  });

  it.each([
    ['zero', { ...deposit, amountCentavos: 0 }],
    ['negative', { ...deposit, amountCentavos: -1 }],
    ['a fraction', { ...deposit, amountCentavos: 1.5 }],
    ['too large', { ...deposit, amountCentavos: 2147483648 }],
    ['pesos as text', { ...deposit, amountCentavos: '100' }],
    ['no label', { ...deposit, label: ' ' }],
    ['bad date', { ...deposit, dueDate: '01/15/2027' }],
  ])('refuses %s', async (_name, item) => {
    expect((await as(owner, 'put', path, { items: [item] })).status).toBe(400);
  });

  it('refuses a repeated id', async () => {
    const id = randomUUID();
    const items = [
      { ...deposit, id },
      { ...balance, id },
    ];
    expect((await as(owner, 'put', path, { items })).status).toBe(400);
  });

  it('changes nothing when an id belongs to another project', async () => {
    const saved = (await as(owner, 'put', path, { items: [deposit] })).body.data.items;
    const client = (await as(owner, 'post', '/clients', { fullName: 'Bea' })).body.data;
    const second = (
      await as(owner, 'post', '/projects', { clientId: client.id, title: 'b', priceCentavos: 1 })
    ).body.data;
    const res = await as(owner, 'put', `/projects/${second.id}/payment-schedule`, {
      items: [balance, { ...deposit, id: saved[0].id }],
    });
    expect(res.status).toBe(404);
    expect(
      (await as(owner, 'get', `/projects/${second.id}/payment-schedule`)).body.data.items,
    ).toEqual([]);
    expect((await as(owner, 'get', path)).body.data.items).toHaveLength(1);
  });

  it('lets staff read it but not change it', async () => {
    await as(owner, 'put', path, { items: [deposit] });
    expect((await as(staff, 'get', path)).body.data.items).toHaveLength(1);
    expect((await as(staff, 'put', path, { items: [] })).status).toBe(403);
    expect((await as(owner, 'get', path)).body.data.items).toHaveLength(1);
  });

  it('refuses a change on an archived project, but still shows it', async () => {
    await as(owner, 'put', path, { items: [deposit] });
    await as(owner, 'post', `/projects/${project.id}/archive`);
    expect((await as(owner, 'put', path, { items: [] })).status).toBe(404);
    expect((await as(owner, 'get', path)).body.data.items).toHaveLength(1);
  });

  it('returns 404 across tenants, changing nothing', async () => {
    const saved = (await as(owner, 'put', path, { items: [deposit] })).body.data.items;
    expect((await as(outsider, 'get', path)).status).toBe(404);
    expect((await as(outsider, 'put', path, { items: [] })).status).toBe(404);

    const client = (await as(outsider, 'post', '/clients', { fullName: 'Out' })).body.data;
    const theirs = (
      await as(outsider, 'post', '/projects', { clientId: client.id, title: 'o', priceCentavos: 1 })
    ).body.data;
    const res = await as(outsider, 'put', `/projects/${theirs.id}/payment-schedule`, {
      items: [{ ...deposit, id: saved[0].id, amountCentavos: 1 }],
    });
    expect(res.status).toBe(404);
    expect((await as(owner, 'get', path)).body.data.items[0].amountCentavos).toBe(5000050);
  });
});
