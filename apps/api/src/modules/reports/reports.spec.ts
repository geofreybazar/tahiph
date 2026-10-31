import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';
import { addMonths, manilaMonth, manilaMonthRange, monthsBetween } from '../../common/http/dates';

const INT_MAX = 2147483647;

describe('month helpers', () => {
  it('reads months on the Manila calendar', () => {
    expect(manilaMonth(new Date('2027-01-31T15:59:00.000Z'))).toBe('2027-01');
    expect(manilaMonth(new Date('2027-01-31T16:00:00.000Z'))).toBe('2027-02');
  });

  it('crosses year ends and leap months', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(manilaMonthRange('2028-02', '2028-02').lt.toISOString()).toBe(
      '2028-02-29T16:00:00.000Z',
    );
  });
});

describe('dashboard and reports', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let outsider: string;
  let client: { id: string };

  const as = (
    user: string,
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    body?: object,
    key?: string,
  ) =>
    t.as(method, url, user, {
      tenant: user === outsider ? other : tenant,
      body,
      headers: key ? { 'Idempotency-Key': key } : undefined,
    });
  const newProject = async (
    priceCentavos: number,
    status = 'active',
    user = owner,
    clientId = client.id,
  ) => {
    const project = (await as(user, 'post', '/projects', { clientId, title: 't', priceCentavos }))
      .body.data;
    if (status !== 'draft') await as(user, 'post', `/projects/${project.id}/status`, { status });
    return project;
  };
  const pay = async (projectId: string, amountCentavos: number, paidAt: string, kind = 'payment') =>
    (
      await as(
        owner,
        'post',
        `/projects/${projectId}/payments`,
        { kind, amountCentavos, method: 'cash', paidAt },
        randomUUID(),
      )
    ).body.data;
  const spend = async (amountCentavos: number, incurredOn: string) =>
    (
      await as(owner, 'post', '/expenses', {
        kind: 'operating',
        category: 'Rent',
        amountCentavos,
        incurredOn,
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
    admin = (await t.createMember(tenant, 'admin')).userId;
    staff = (await t.createMember(tenant, 'staff')).userId;
    outsider = (await t.createMember(other, 'owner')).userId;
    client = (await as(owner, 'post', '/clients', { fullName: 'Alma' })).body.data;
  });

  describe('access', () => {
    const FINANCIAL = [
      '/dashboard/financial',
      '/reports/sales',
      '/reports/revenue',
      '/reports/profit',
      '/reports/receivables',
      '/reports/operations',
    ];

    it.each(FINANCIAL)('refuses staff on %s, and allows managers', async (url) => {
      expect((await as(staff, 'get', url)).status).toBe(403);
      expect((await as(admin, 'get', url)).status).toBe(200);
      expect((await as(owner, 'get', url)).status).toBe(200);
    });

    it('gives staff the operations dashboard with no money in it', async () => {
      const project = await newProject(15000050);
      const garment = (
        await as(owner, 'post', `/projects/${project.id}/garments`, {
          name: 'Gown',
          wearerName: 'Alma',
          wearerRole: 'bride',
        })
      ).body.data;
      await as(owner, 'post', '/appointments', {
        type: 'fitting',
        garmentId: garment.id,
        startsAt: '2099-01-15T02:00:00.000Z',
        endsAt: '2099-01-15T03:00:00.000Z',
      });
      const res = await as(staff, 'get', '/dashboard/operations');
      expect(res.status).toBe(200);
      expect(res.body.data.garmentsByStage).toMatchObject({ design: 1, sewing: 0 });
      expect(res.body.data.upcomingFittings[0].client.fullName).toBe('Alma');
      expect(JSON.stringify(res.body)).not.toMatch(/centavos|price|revenue|profit|15000050/i);
    });
  });

  describe('operations dashboard', () => {
    it('lists only future scheduled fittings, soonest first, up to ten', async () => {
      const at = (day: string, over: object = {}) =>
        as(owner, 'post', '/appointments', {
          type: 'fitting',
          startsAt: `${day}T02:00:00.000Z`,
          endsAt: `${day}T03:00:00.000Z`,
          ...over,
        });
      await at('2020-01-01');
      await at('2099-01-02', { type: 'pickup' });
      const cancelled = (await at('2099-01-03')).body.data;
      await as(owner, 'post', `/appointments/${cancelled.id}/status`, { status: 'cancelled' });
      for (let day = 10; day < 22; day++) await at(`2099-01-${day}`);
      const items = (await as(staff, 'get', '/dashboard/operations')).body.data.upcomingFittings;
      expect(items).toHaveLength(10);
      expect(items[0].startsAt).toBe('2099-01-10T02:00:00.000Z');
    });

    it('does not count garments on archived projects', async () => {
      const project = await newProject(1);
      await as(owner, 'post', `/projects/${project.id}/garments`, {
        name: 'G',
        wearerName: 'A',
        wearerRole: 'bride',
      });
      await as(owner, 'post', `/projects/${project.id}/archive`);
      expect(
        (await as(staff, 'get', '/dashboard/operations')).body.data.garmentsByStage.design,
      ).toBe(0);
    });
  });

  describe('revenue', () => {
    it('is payments minus refunds, ignoring voided rows, by Manila month', async () => {
      const project = await newProject(100000);
      // Manila is UTC+8: 15:59 UTC on 31 Jan is still January there, and 16:00 UTC is February.
      await pay(project.id, 1000, '2026-01-31T15:59:00.000Z');
      await pay(project.id, 2000, '2026-01-31T16:00:00.000Z');
      await pay(project.id, 300, '2026-02-10T02:00:00.000Z', 'refund');
      const voided = await pay(project.id, 9999, '2026-02-10T02:00:00.000Z');
      await as(owner, 'post', `/payments/${voided.id}/void`, { reason: 'x' });
      const res = await as(owner, 'get', '/reports/revenue?from=2026-01&to=2026-03');
      expect(res.body.data.items).toEqual([
        { month: '2026-01', paidCentavos: 1000, refundedCentavos: 0, revenueCentavos: 1000 },
        { month: '2026-02', paidCentavos: 2000, refundedCentavos: 300, revenueCentavos: 1700 },
        { month: '2026-03', paidCentavos: 0, refundedCentavos: 0, revenueCentavos: 0 },
      ]);
      expect(res.body.data.totals).toEqual({
        paidCentavos: 3000,
        refundedCentavos: 300,
        revenueCentavos: 2700,
      });
    });

    it('stays exact when totals pass the limit of an Int column', async () => {
      const project = await newProject(INT_MAX);
      await pay(project.id, INT_MAX, '2026-01-10T02:00:00.000Z');
      await pay(project.id, INT_MAX, '2026-01-11T02:00:00.000Z');
      await pay(project.id, INT_MAX, '2026-01-12T02:00:00.000Z');
      const res = await as(owner, 'get', '/reports/revenue?from=2026-01&to=2026-01');
      expect(res.body.data.totals.revenueCentavos).toBe(6442450941);
    });
  });

  describe('profit', () => {
    it('is revenue minus non-deleted expenses, and can be negative', async () => {
      const project = await newProject(100000);
      await pay(project.id, 5000, '2026-01-10T02:00:00.000Z');
      await spend(2000, '2026-01-31');
      await spend(7000, '2026-02-01');
      const gone = await spend(99999, '2026-01-15');
      await as(owner, 'delete', `/expenses/${gone.id}`);
      const res = await as(owner, 'get', '/reports/profit?from=2026-01&to=2026-02');
      expect(res.body.data.items).toEqual([
        { month: '2026-01', revenueCentavos: 5000, expensesCentavos: 2000, profitCentavos: 3000 },
        { month: '2026-02', revenueCentavos: 0, expensesCentavos: 7000, profitCentavos: -7000 },
      ]);
      expect(res.body.data.totals.profitCentavos).toBe(-4000);
    });

    it('leaves out expenses just past the period', async () => {
      await spend(100, '2026-01-31');
      await spend(200, '2026-02-01');
      const res = await as(owner, 'get', '/reports/profit?from=2026-01&to=2026-01');
      expect(res.body.data.totals.expensesCentavos).toBe(100);
    });
  });

  describe('receivables', () => {
    it('sums balances of active projects only, per the approved definition', async () => {
      const active = await newProject(10000);
      await pay(active.id, 2500, '2026-01-10T02:00:00.000Z');
      const overpaid = await newProject(100);
      await pay(overpaid.id, 150, '2026-01-10T02:00:00.000Z');
      await newProject(777, 'draft');
      await newProject(888, 'completed');
      await newProject(999, 'cancelled');
      const archived = await newProject(555);
      await as(owner, 'post', `/projects/${archived.id}/archive`);

      const { items, totalCentavos } = (await as(owner, 'get', '/reports/receivables')).body.data;
      expect(items.map((i: { id: string }) => i.id).sort()).toEqual(
        [active.id, overpaid.id].sort(),
      );
      expect(items.find((i: { id: string }) => i.id === active.id)).toMatchObject({
        clientName: 'Alma',
        balanceCentavos: 7500,
      });
      expect(totalCentavos).toBe(7450);
    });

    it('follows voids and refunds', async () => {
      const project = await newProject(10000);
      const made = await pay(project.id, 4000, '2026-01-10T02:00:00.000Z');
      await pay(project.id, 1000, '2026-01-11T02:00:00.000Z', 'refund');
      expect((await as(owner, 'get', '/reports/receivables')).body.data.totalCentavos).toBe(7000);
      await as(owner, 'post', `/payments/${made.id}/void`, { reason: 'x' });
      expect((await as(owner, 'get', '/reports/receivables')).body.data.totalCentavos).toBe(11000);
    });
  });

  describe('sales', () => {
    it('counts active and completed orders this month, not drafts or cancelled', async () => {
      const month = manilaMonth(new Date());
      await newProject(1000);
      await newProject(2000, 'completed');
      await newProject(4000, 'draft');
      await newProject(8000, 'cancelled');
      const archived = await newProject(16000);
      await as(owner, 'post', `/projects/${archived.id}/archive`);
      const res = await as(owner, 'get', `/reports/sales?from=${month}&to=${month}`);
      expect(res.body.data.items).toEqual([{ month, orderCount: 2, soldCentavos: 3000 }]);
    });
  });

  describe('operations report', () => {
    it('counts appointments by status and Manila month, with stages', async () => {
      const at = async (startsAt: string, status?: string) => {
        const made = (
          await as(owner, 'post', '/appointments', {
            type: 'other',
            startsAt,
            endsAt: new Date(new Date(startsAt).getTime() + 60000).toISOString(),
          })
        ).body.data;
        if (status) await as(owner, 'post', `/appointments/${made.id}/status`, { status });
      };
      await at('2026-01-31T15:59:00.000Z', 'completed');
      await at('2026-01-31T16:00:00.000Z', 'no_show');
      await at('2026-02-02T02:00:00.000Z');
      const res = await as(owner, 'get', '/reports/operations?from=2026-01&to=2026-02');
      expect(res.body.data.appointments).toEqual([
        { month: '2026-01', scheduled: 0, completed: 1, cancelled: 0, no_show: 0 },
        { month: '2026-02', scheduled: 1, completed: 0, cancelled: 0, no_show: 1 },
      ]);
      expect(Object.keys(res.body.data.garmentsByStage)).toHaveLength(9);
    });
  });

  describe('financial dashboard', () => {
    it('shows this Manila month and all receivables', async () => {
      const project = await newProject(10000);
      await pay(project.id, 3000, new Date().toISOString());
      await pay(project.id, 1000, '2020-01-10T02:00:00.000Z');
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Manila' }).format();
      await spend(500, today);
      expect((await as(admin, 'get', '/dashboard/financial')).body.data).toEqual({
        month: manilaMonth(new Date()),
        revenueCentavos: 3000,
        expensesCentavos: 500,
        profitCentavos: 2500,
        receivablesCentavos: 6000,
      });
    });
  });

  describe('period', () => {
    it('defaults to the last 12 months, ending now', async () => {
      const { from, to, items } = (await as(owner, 'get', '/reports/revenue')).body.data;
      expect(to).toBe(manilaMonth(new Date()));
      expect(from).toBe(addMonths(to, -11));
      expect(items).toHaveLength(12);
    });

    it.each([
      ['a bad month', 'from=2026-13'],
      ['a day', 'from=2026-01-01'],
      ['reversed', 'from=2026-03&to=2026-01'],
      ['too long', 'from=2020-01&to=2026-01'],
    ])('refuses %s', async (_name, query) => {
      for (const report of ['sales', 'revenue', 'profit', 'operations']) {
        expect((await as(owner, 'get', `/reports/${report}?${query}`)).status).toBe(400);
      }
    });
  });

  it("never mixes in another tenant's numbers", async () => {
    const theirClient = (await as(outsider, 'post', '/clients', { fullName: 'Out' })).body.data;
    const theirs = await newProject(50000, 'active', outsider, theirClient.id);
    await as(
      outsider,
      'post',
      `/projects/${theirs.id}/payments`,
      { kind: 'payment', amountCentavos: 1234, method: 'cash', paidAt: '2026-01-10T02:00:00.000Z' },
      randomUUID(),
    );
    await as(outsider, 'post', '/expenses', {
      kind: 'operating',
      category: 'x',
      amountCentavos: 4321,
      incurredOn: '2026-01-10',
    });
    await as(outsider, 'post', `/projects/${theirs.id}/garments`, {
      name: 'G',
      wearerName: 'A',
      wearerRole: 'bride',
    });
    const q = '?from=2026-01&to=2026-01';
    expect((await as(owner, 'get', `/reports/revenue${q}`)).body.data.totals.revenueCentavos).toBe(
      0,
    );
    expect((await as(owner, 'get', `/reports/profit${q}`)).body.data.totals.expensesCentavos).toBe(
      0,
    );
    expect((await as(owner, 'get', '/reports/receivables')).body.data).toEqual({
      items: [],
      totalCentavos: 0,
    });
    expect((await as(owner, 'get', '/dashboard/operations')).body.data.garmentsByStage.design).toBe(
      0,
    );
    expect((await as(owner, 'get', '/dashboard/financial')).body.data.receivablesCentavos).toBe(0);
    expect((await as(outsider, 'get', '/dashboard/financial')).body.data.receivablesCentavos).toBe(
      48766,
    );
  });
});
