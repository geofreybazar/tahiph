import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, TestApp } from '../../../test/harness';
import { StorageService } from '../../common/storage/storage.service';

describe('expenses', () => {
  let t: TestApp;
  let tenant: string;
  let other: string;
  let owner: string;
  let admin: string;
  let staff: string;
  let outsider: string;

  const as = (
    user: string,
    method: 'get' | 'post' | 'patch' | 'delete',
    url: string,
    body?: object,
  ) => t.as(method, url, user, { tenant: user === outsider ? other : tenant, body });
  const expense = {
    kind: 'operating',
    category: 'Rent',
    amountCentavos: 2500050,
    incurredOn: '2027-01-15',
  };
  const make = async (user = owner, body: object = expense) =>
    (await as(user, 'post', '/expenses', body)).body.data;
  const file = (tenantId: string, uploadedByUserId: string, over: object = {}) =>
    t.base.mediaFile.create({
      data: {
        tenantId,
        uploadedByUserId,
        bucket: 'private_media',
        objectKey: `${tenantId}/expense_receipt/${randomUUID()}.png`,
        purpose: 'expense_receipt',
        mimeType: 'image/png',
        sizeBytes: 1,
        status: 'ready',
        ...over,
      } as never,
    });
  const newProject = async (user = owner) => {
    const client = (await as(user, 'post', '/clients', { fullName: 'Alma' })).body.data;
    return (
      await as(user, 'post', '/projects', { clientId: client.id, title: 't', priceCentavos: 1 })
    ).body.data;
  };

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
  });

  it('creates, with a calendar day and who recorded it', async () => {
    const res = await as(admin, 'post', '/expenses', {
      ...expense,
      description: '',
      tenantId: other,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      incurredOn: '2027-01-15',
      amountCentavos: 2500050,
      description: null,
      tenantId: tenant,
      recordedByUserId: admin,
    });
  });

  it.each([
    ['zero', { ...expense, amountCentavos: 0 }],
    ['negative', { ...expense, amountCentavos: -1 }],
    ['a fraction', { ...expense, amountCentavos: 1.5 }],
    ['too large', { ...expense, amountCentavos: 2147483648 }],
    ['text', { ...expense, amountCentavos: '100' }],
    ['unknown kind', { ...expense, kind: 'other' }],
    ['no category', { ...expense, category: ' ' }],
    ['bad date', { ...expense, incurredOn: '01/15/2027' }],
  ])('refuses %s', async (_name, body) => {
    expect((await as(owner, 'post', '/expenses', body)).status).toBe(400);
  });

  it('is refused for staff on every route', async () => {
    const made = await make();
    const path = `/expenses/${made.id}`;
    expect((await as(staff, 'get', '/expenses')).status).toBe(403);
    expect((await as(staff, 'post', '/expenses', expense)).status).toBe(403);
    expect((await as(staff, 'get', path)).status).toBe(403);
    expect((await as(staff, 'patch', path, expense)).status).toBe(403);
    expect((await as(staff, 'delete', path)).status).toBe(403);
    expect((await as(owner, 'get', path)).status).toBe(200);
  });

  it('filters by inclusive dates and kind, newest first', async () => {
    const jan = await make(owner, { ...expense, incurredOn: '2027-01-31' });
    const feb = await make(owner, { ...expense, incurredOn: '2027-02-01', kind: 'production' });
    await make(owner, { ...expense, incurredOn: '2027-02-02' });
    const ids = async (query: string) =>
      (await as(owner, 'get', `/expenses?${query}`)).body.data.map((e: { id: string }) => e.id);
    expect(await ids('from=2027-01-31&to=2027-02-01')).toEqual([feb.id, jan.id]);
    expect(await ids('kind=production')).toEqual([feb.id]);
    expect(Object.keys((await as(owner, 'get', '/expenses')).body.meta).sort()).toEqual([
      'limit',
      'page',
      'total',
      'totalPages',
    ]);
  });

  it('soft deletes: hidden everywhere, but the row remains', async () => {
    const made = await make();
    const path = `/expenses/${made.id}`;
    expect((await as(owner, 'delete', path)).status).toBe(204);
    expect((await as(owner, 'get', path)).status).toBe(404);
    expect((await as(owner, 'patch', path, expense)).status).toBe(404);
    expect((await as(owner, 'delete', path)).status).toBe(404);
    expect((await as(owner, 'get', '/expenses')).body.data).toEqual([]);
    const row = await t.base.expense.findUnique({ where: { id: made.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  describe('project link', () => {
    it('links, clears, and refuses an archived or foreign project', async () => {
      const project = await newProject();
      const made = await make(owner, { ...expense, projectId: project.id });
      expect(made.project.id).toBe(project.id);
      const path = `/expenses/${made.id}`;

      await as(owner, 'post', `/projects/${project.id}/archive`);
      // Editing keeps a link to a project archived since.
      const kept = await as(owner, 'patch', path, {
        ...expense,
        projectId: project.id,
        category: 'Lace',
      });
      expect(kept.body.data).toMatchObject({ category: 'Lace', projectId: project.id });
      const archived = await as(owner, 'post', '/expenses', { ...expense, projectId: project.id });
      expect(archived.status).toBe(404);

      const theirs = await newProject(outsider);
      expect(
        (await as(owner, 'post', '/expenses', { ...expense, projectId: theirs.id })).status,
      ).toBe(404);
      expect((await as(owner, 'patch', path, { ...expense, projectId: theirs.id })).status).toBe(
        404,
      );
      expect((await as(owner, 'patch', path, expense)).body.data.projectId).toBeNull();
    });

    it('the database refuses a foreign project', async () => {
      const made = await make();
      const theirs = await newProject(outsider);
      await expect(
        t.base.expense.update({ where: { id: made.id }, data: { projectId: theirs.id } }),
      ).rejects.toThrow();
    });
  });

  describe('receipts', () => {
    let remove: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      remove = vi.spyOn(t.app.get(StorageService, { strict: false }), 'remove').mockResolvedValue();
    });
    afterAll(() => remove.mockRestore());

    it('attaches a confirmed receipt only', async () => {
      const receipt = await file(tenant, owner);
      expect((await make(owner, { ...expense, receiptMediaId: receipt.id })).receiptMediaId).toBe(
        receipt.id,
      );
      const pending = await file(tenant, owner, { status: 'pending' });
      expect(
        (await as(owner, 'post', '/expenses', { ...expense, receiptMediaId: pending.id })).status,
      ).toBe(409);
      const sketch = await file(tenant, owner, { purpose: 'sketch' });
      expect(
        (await as(owner, 'post', '/expenses', { ...expense, receiptMediaId: sketch.id })).status,
      ).toBe(422);
      expect(
        (await as(owner, 'post', '/expenses', { ...expense, receiptMediaId: receipt.id })).status,
      ).toBe(409);
    });

    it('keeps it when left out, and deletes the old file when replaced or cleared', async () => {
      const first = await file(tenant, owner);
      const made = await make(owner, { ...expense, receiptMediaId: first.id });
      const path = `/expenses/${made.id}`;
      expect((await as(owner, 'patch', path, expense)).body.data.receiptMediaId).toBe(first.id);
      expect(remove).not.toHaveBeenCalled();

      const second = await file(tenant, owner);
      const replaced = await as(owner, 'patch', path, { ...expense, receiptMediaId: second.id });
      expect(replaced.body.data.receiptMediaId).toBe(second.id);
      expect(await t.base.mediaFile.findUnique({ where: { id: first.id } })).toBeNull();

      const cleared = await as(owner, 'patch', path, { ...expense, receiptMediaId: null });
      expect(cleared.body.data.receiptMediaId).toBeNull();
      expect(await t.base.mediaFile.findUnique({ where: { id: second.id } })).toBeNull();
    });

    it('changes nothing when storage fails during a replacement', async () => {
      const first = await file(tenant, owner);
      const made = await make(owner, { ...expense, receiptMediaId: first.id });
      const second = await file(tenant, owner);
      remove.mockRejectedValueOnce(new Error('storage down'));
      const res = await as(owner, 'patch', `/expenses/${made.id}`, {
        ...expense,
        category: 'Changed',
        receiptMediaId: second.id,
      });
      expect(res.status).toBe(500);
      const got = (await as(owner, 'get', `/expenses/${made.id}`)).body.data;
      expect(got).toMatchObject({ receiptMediaId: first.id, category: 'Rent' });
    });

    it('protects an attached receipt from direct deletion', async () => {
      const receipt = await file(tenant, owner);
      await make(owner, { ...expense, receiptMediaId: receipt.id });
      expect((await as(owner, 'delete', `/media/${receipt.id}`)).status).toBe(409);
    });

    it('keeps staff out of receipts', async () => {
      const receipt = await file(tenant, owner);
      await make(owner, { ...expense, receiptMediaId: receipt.id });
      expect((await as(staff, 'get', `/media/${receipt.id}/download-url`)).status).toBe(403);
    });

    it("refuses another tenant's receipt; the database does too", async () => {
      const theirs = await file(other, outsider);
      expect(
        (await as(owner, 'post', '/expenses', { ...expense, receiptMediaId: theirs.id })).status,
      ).toBe(404);
      const made = await make();
      await expect(
        t.base.expense.update({ where: { id: made.id }, data: { receiptMediaId: theirs.id } }),
      ).rejects.toThrow();
    });
  });

  it('returns 404 across tenants, changing nothing', async () => {
    const made = await make();
    const path = `/expenses/${made.id}`;
    expect((await as(outsider, 'get', path)).status).toBe(404);
    expect((await as(outsider, 'patch', path, { ...expense, category: 'Hacked' })).status).toBe(
      404,
    );
    expect((await as(outsider, 'delete', path)).status).toBe(404);
    expect((await as(outsider, 'get', '/expenses')).body.data).toEqual([]);
    expect((await as(owner, 'get', path)).body.data.category).toBe('Rent');
  });
});
