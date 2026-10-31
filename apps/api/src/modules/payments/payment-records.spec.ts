import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';
import { deriveBalance } from './payments.service';

describe('deriveBalance', () => {
  const row = (kind: 'payment' | 'refund', amountCentavos: number, voided = false) => ({
    kind,
    amountCentavos,
    voidedAt: voided ? new Date() : null,
  });

  it('is price minus payments plus refunds, ignoring voided rows', () => {
    expect(
      deriveBalance(100000, [
        row('payment', 30000),
        row('payment', 99999, true),
        row('refund', 5000),
        row('refund', 77777, true),
      ]),
    ).toEqual({
      priceCentavos: 100000,
      paidCentavos: 30000,
      refundedCentavos: 5000,
      balanceCentavos: 75000,
    });
  });

  it('goes negative when overpaid', () => {
    expect(deriveBalance(100, [row('payment', 150)]).balanceCentavos).toBe(-50);
  });
});

describe('payments', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let staff: string;
  let outsider: string;
  let client: { id: string };
  let project: { id: string };
  let path: string;

  const as = (
    user: string,
    method: 'get' | 'post' | 'put',
    url: string,
    body?: object,
    key?: string,
  ) =>
    t.as(method, url, user, {
      tenant: user === outsider ? other : tenant,
      body,
      headers: key ? { 'Idempotency-Key': key } : undefined,
    });
  const payment = {
    kind: 'payment',
    amountCentavos: 5000050,
    method: 'gcash',
    paidAt: '2027-01-15T02:00:00.000Z',
  };
  const pastPayment = { ...payment, paidAt: '2026-01-15T02:00:00.000Z' };
  const pay = (user = staff, body: object = pastPayment, key = randomUUID(), url = path) =>
    as(user, 'post', url, body, key);
  const summary = async () => (await as(owner, 'get', path)).body.data;

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
    project = (
      await as(owner, 'post', '/projects', {
        clientId: client.id,
        title: 't',
        priceCentavos: 15000050,
      })
    ).body.data;
    path = `/projects/${project.id}/payments`;
  });

  it('records a payment; the balance is derived', async () => {
    const res = await pay();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      amountCentavos: 5000050,
      recordedBy: { email: `${staff}@example.test` },
      voidedAt: null,
    });
    expect(res.body.data.idempotencyKey).toBeUndefined();
    expect(await summary()).toMatchObject({
      paidCentavos: 5000050,
      refundedCentavos: 0,
      balanceCentavos: 10000000,
    });
  });

  it.each([
    ['zero', { ...pastPayment, amountCentavos: 0 }],
    ['negative', { ...pastPayment, amountCentavos: -1 }],
    ['a fraction', { ...pastPayment, amountCentavos: 1.5 }],
    ['too large', { ...pastPayment, amountCentavos: 2147483648 }],
    ['text', { ...pastPayment, amountCentavos: '100' }],
    ['unknown method', { ...pastPayment, method: 'barter' }],
    ['unknown kind', { ...pastPayment, kind: 'gift' }],
    ['a bad date', { ...pastPayment, paidAt: '15/01/2026' }],
    ['a day with no time', { ...pastPayment, paidAt: '2026-01-15' }],
  ])('refuses %s', async (_name, body) => {
    expect((await pay(owner, body)).status).toBe(400);
    expect((await summary()).items).toEqual([]);
  });

  it('refuses a payment dated in the future', async () => {
    const paidAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await pay(owner, { ...pastPayment, paidAt })).status).toBe(422);
  });

  it('never trusts tenant or balance fields in the body', async () => {
    const res = await pay(owner, {
      ...pastPayment,
      tenantId: other,
      voidedAt: null,
      recordedByUserId: staff,
    });
    expect(res.body.data.tenantId).toBe(tenant);
    expect(res.body.data.recordedByUserId).toBe(owner);
  });

  describe('idempotency', () => {
    it.each([
      ['missing', undefined],
      ['malformed', 'not-a-uuid'],
    ])('requires a key: %s', async (_name, key) => {
      expect((await as(owner, 'post', path, pastPayment, key)).status).toBe(400);
    });

    it('records money once when retried', async () => {
      const key = randomUUID();
      const first = await pay(owner, pastPayment, key);
      const second = await pay(owner, pastPayment, key);
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect((await summary()).items).toHaveLength(1);
    });

    it('records money once under simultaneous retries', async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pay(owner, pastPayment, key)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect((await summary()).paidCentavos).toBe(5000050);
    });

    it('refuses the key for a different payment', async () => {
      const key = randomUUID();
      await pay(owner, pastPayment, key);
      const res = await pay(owner, { ...pastPayment, amountCentavos: 1 }, key);
      expect(res.status).toBe(409);
      expect((await summary()).paidCentavos).toBe(5000050);
    });

    it('lets two tenants use the same key', async () => {
      const key = randomUUID();
      await pay(owner, pastPayment, key);
      const c = (await as(outsider, 'post', '/clients', { fullName: 'Out' })).body.data;
      const p = (
        await as(outsider, 'post', '/projects', { clientId: c.id, title: 'o', priceCentavos: 1 })
      ).body.data;
      const res = await pay(outsider, pastPayment, key, `/projects/${p.id}/payments`);
      expect(res.status).toBe(201);
      expect(res.body.data.tenantId).toBe(other);
      expect((await summary()).items).toHaveLength(1);
    });
  });

  describe('refunds', () => {
    const refund = { ...pastPayment, kind: 'refund', amountCentavos: 100 };

    it('adds back to the balance, for managers only', async () => {
      await pay();
      expect((await pay(staff, refund)).status).toBe(403);
      expect((await pay(owner, refund)).status).toBe(201);
      expect(await summary()).toMatchObject({ refundedCentavos: 100, balanceCentavos: 10000100 });
    });

    it('does not let staff replay a refund key', async () => {
      const key = randomUUID();
      await pay(owner, refund, key);
      expect((await pay(staff, refund, key)).status).toBe(403);
    });
  });

  describe('voiding', () => {
    it('keeps the row, restores the balance, and is audited', async () => {
      const made = (await pay()).body.data;
      const res = await as(owner, 'post', `/payments/${made.id}/void`, { reason: 'Wrong amount' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        voidReason: 'Wrong amount',
        voidedBy: { email: `${owner}@example.test` },
      });
      const got = await summary();
      expect(got.items).toHaveLength(1);
      expect(got.balanceCentavos).toBe(15000050);
      const log = await t.base.auditLog.findFirst({
        where: { tenantId: tenant, action: 'payment.voided', entityId: made.id },
      });
      expect(log?.metadata).toMatchObject({ amountCentavos: 5000050, reason: 'Wrong amount' });
    });

    it('needs a reason, a manager, and only happens once', async () => {
      const made = (await pay()).body.data;
      const url = `/payments/${made.id}/void`;
      expect((await as(owner, 'post', url, { reason: ' ' })).status).toBe(400);
      expect((await as(staff, 'post', url, { reason: 'x' })).status).toBe(403);
      expect((await as(owner, 'post', url, { reason: 'first' })).status).toBe(200);
      expect((await as(owner, 'post', url, { reason: 'second' })).status).toBe(409);
      expect((await summary()).items[0].voidReason).toBe('first');
    });

    it('voids once when two managers try together', async () => {
      const made = (await pay()).body.data;
      const url = `/payments/${made.id}/void`;
      const results = await Promise.all([
        as(owner, 'post', url, { reason: 'a' }),
        as(owner, 'post', url, { reason: 'b' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const logs = await t.base.auditLog.count({
        where: { tenantId: tenant, action: 'payment.voided', entityId: made.id },
      });
      expect(logs).toBe(1);
    });

    it('offers no way to edit or delete a payment', async () => {
      const made = (await pay()).body.data;
      const url = `/payments/${made.id}`;
      expect(
        (await t.as('patch', url, owner, { tenant, body: { amountCentavos: 1 } })).status,
      ).toBe(404);
      expect((await t.as('delete', url, owner, { tenant })).status).toBe(404);
    });

    it('the database refuses a half-recorded void', async () => {
      const made = (await pay()).body.data;
      await expect(
        t.base.payment.update({ where: { id: made.id }, data: { voidedAt: new Date() } }),
      ).rejects.toThrow();
    });
  });

  describe('links', () => {
    const file = (tenantId: string, uploadedByUserId: string, over: object = {}) =>
      t.base.mediaFile.create({
        data: {
          tenantId,
          uploadedByUserId,
          bucket: 'private_media',
          objectKey: `${tenantId}/payment_proof/${randomUUID()}.png`,
          purpose: 'payment_proof',
          mimeType: 'image/png',
          sizeBytes: 1,
          status: 'ready',
          ...over,
        } as never,
      });

    it('links a schedule item of this project only', async () => {
      const schedulePath = `/projects/${project.id}/payment-schedule`;
      const item = (
        await as(owner, 'put', schedulePath, {
          items: [{ label: 'Deposit', dueDate: '2027-01-15', amountCentavos: 100 }],
        })
      ).body.data.items[0];
      const made = await pay(staff, { ...pastPayment, scheduleItemId: item.id });
      expect(made.body.data.scheduleItem.label).toBe('Deposit');

      // A schedule item that has payments can't be dropped; it can be kept and edited.
      expect((await as(owner, 'put', schedulePath, { items: [] })).status).toBe(409);
      expect((await as(owner, 'get', schedulePath)).body.data.items).toHaveLength(1);

      const second = (
        await as(owner, 'post', '/projects', { clientId: client.id, title: 'b', priceCentavos: 1 })
      ).body.data;
      const res = await pay(
        owner,
        { ...pastPayment, scheduleItemId: item.id },
        randomUUID(),
        `/projects/${second.id}/payments`,
      );
      expect(res.status).toBe(404);
    });

    it('attaches only a confirmed proof, which then cannot be deleted', async () => {
      const proof = await file(tenant, staff);
      const made = await pay(staff, { ...pastPayment, proofMediaId: proof.id });
      expect(made.body.data.proofMediaId).toBe(proof.id);
      expect((await as(staff, 'get', `/media/${proof.id}/download-url`)).status).not.toBe(403);
      expect((await t.as('delete', `/media/${proof.id}`, staff, { tenant })).status).toBe(409);

      const pending = await file(tenant, staff, { status: 'pending' });
      expect((await pay(staff, { ...pastPayment, proofMediaId: pending.id })).status).toBe(409);
      const sketch = await file(tenant, staff, { purpose: 'sketch' });
      expect((await pay(staff, { ...pastPayment, proofMediaId: sketch.id })).status).toBe(422);
    });

    it("refuses another tenant's proof and schedule item; the database does too", async () => {
      const theirs = await file(other, outsider);
      expect((await pay(owner, { ...pastPayment, proofMediaId: theirs.id })).status).toBe(404);
      const made = (await pay()).body.data;
      await expect(
        t.base.payment.update({ where: { id: made.id }, data: { proofMediaId: theirs.id } }),
      ).rejects.toThrow();
    });
  });

  describe('lists', () => {
    it('hides the tenant-wide list from staff, and shows per-client history', async () => {
      await pay();
      expect((await as(staff, 'get', '/payments')).status).toBe(403);
      const all = await as(owner, 'get', '/payments');
      expect(all.body.data).toHaveLength(1);
      expect(all.body.meta.total).toBe(1);
      const history = await as(staff, 'get', `/clients/${client.id}/payments`);
      expect(history.body.data[0].project.id).toBe(project.id);
    });

    it('filters by Manila calendar days', async () => {
      // Manila is UTC+8, so the 15th there runs from 16:00 UTC on the 14th to 15:59 UTC on the 15th.
      await pay(owner, { ...pastPayment, paidAt: '2026-01-14T15:59:00.000Z' });
      const inside = await pay(owner, { ...pastPayment, paidAt: '2026-01-14T16:00:00.000Z' });
      const late = await pay(owner, { ...pastPayment, paidAt: '2026-01-15T15:59:00.000Z' });
      await pay(owner, { ...pastPayment, paidAt: '2026-01-15T16:00:00.000Z' });
      const res = await as(owner, 'get', '/payments?from=2026-01-15&to=2026-01-15');
      expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual(
        [inside.body.data.id, late.body.data.id].sort(),
      );
    });

    it('still shows an archived project but refuses new payments', async () => {
      await pay();
      await as(owner, 'post', `/projects/${project.id}/archive`);
      expect((await pay()).status).toBe(404);
      expect((await summary()).items).toHaveLength(1);
    });
  });

  it('returns 404 across tenants, changing nothing', async () => {
    const made = (await pay()).body.data;
    expect((await as(outsider, 'get', path)).status).toBe(404);
    expect((await pay(outsider)).status).toBe(404);
    expect((await as(outsider, 'get', `/clients/${client.id}/payments`)).status).toBe(404);
    expect((await as(outsider, 'post', `/payments/${made.id}/void`, { reason: 'x' })).status).toBe(
      404,
    );
    expect((await as(outsider, 'get', '/payments')).body.data).toEqual([]);
    expect((await summary()).items[0].voidedAt).toBeNull();
  });
});
