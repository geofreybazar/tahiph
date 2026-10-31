import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client as PgClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_TEST_URL, API_URL } from '../../../test/db-urls';
import { PrismaClient } from '../../generated/prisma/client';
import { createBasePrisma, createScopedPrisma, ScopedPrisma } from './prisma-clients';
import { CROSS_TENANT_MODELS, SELF_SCOPED_MODEL, TENANT_MODELS } from './tenant-registry';
import { scopeOperation, TenantScopeViolation } from './tenant-scope';

const context = new AsyncLocalStorage<string>();
let base: PrismaClient;
let db: ScopedPrisma;
let tenantA: string;
let tenantB: string;
let clientA: string;
let clientB: string;
let userA: string;

// Await inside the context: Prisma promises are lazy and only run their query when awaited.
const asA = <T>(fn: () => T) => context.run(tenantA, async () => await fn());
const violation = (promise: () => unknown) =>
  expect((async () => promise())()).rejects.toThrow(TenantScopeViolation);

beforeAll(async () => {
  base = createBasePrisma(API_URL);
  db = createScopedPrisma(base, () => context.getStore());
});
afterAll(() => base.$disconnect());

beforeEach(async () => {
  const unique = randomUUID().slice(0, 8);
  tenantA = (await base.tenant.create({ data: { slug: `a-${unique}`, name: 'A' } })).id;
  tenantB = (await base.tenant.create({ data: { slug: `b-${unique}`, name: 'B' } })).id;
  userA = randomUUID();
  await base.user.create({ data: { id: userA, email: `${unique}@example.test` } });
  await base.tenantMembership.createMany({
    data: [
      { tenantId: tenantA, userId: userA, role: 'owner' },
      { tenantId: tenantB, userId: userA, role: 'staff' },
    ],
  });
  clientA = (await base.client.create({ data: { tenantId: tenantA, fullName: 'Alma' } })).id;
  clientB = (await base.client.create({ data: { tenantId: tenantB, fullName: 'Bea' } })).id;
});

describe('reads see only the current tenant', () => {
  it('findMany and findFirst', async () => {
    const rows = await asA(() => db.client.findMany({ where: { id: { in: [clientA, clientB] } } }));
    expect(rows.map((r) => r.id)).toEqual([clientA]);
    expect(await asA(() => db.client.findFirst({ where: { id: clientB } }))).toBeNull();
  });

  it('findUnique, by id and by composite key', async () => {
    expect(await asA(() => db.client.findUnique({ where: { id: clientA } }))).not.toBeNull();
    expect(await asA(() => db.client.findUnique({ where: { id: clientB } }))).toBeNull();
    expect(
      await asA(() =>
        db.client.findUnique({ where: { tenantId_id: { tenantId: tenantB, id: clientB } } }),
      ),
    ).toBeNull();
  });

  it('the OrThrow variants', async () => {
    await expect(
      asA(() => db.client.findUniqueOrThrow({ where: { id: clientB } })),
    ).rejects.toThrow();
    await expect(
      asA(() => db.client.findFirstOrThrow({ where: { id: clientB } })),
    ).rejects.toThrow();
  });

  it('an OR filter cannot escape the tenant', async () => {
    const rows = await asA(() =>
      db.client.findMany({ where: { OR: [{ id: clientB }, { id: clientA }] } }),
    );
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it('count, aggregate and groupBy', async () => {
    const ids = { id: { in: [clientA, clientB] } };
    expect(await asA(() => db.client.count({ where: ids }))).toBe(1);
    const aggregate = await asA(() => db.client.aggregate({ where: ids, _count: true }));
    expect(aggregate._count).toBe(1);
    const groups = await asA(() => db.client.groupBy({ by: ['tenantId'], where: ids }));
    expect(groups).toEqual([{ tenantId: tenantA }]);
  });

  it('naming another tenant in where is refused', async () => {
    await violation(() => asA(() => db.client.findMany({ where: { tenantId: tenantB } })));
  });
});

describe('writes touch only the current tenant', () => {
  const unchanged = async () => {
    const row = await base.client.findUniqueOrThrow({ where: { id: clientB } });
    expect(row.fullName).toBe('Bea');
  };

  it('create stamps the tenant', async () => {
    const row = await asA(() => db.client.create({ data: { fullName: 'New' } as never }));
    expect(row.tenantId).toBe(tenantA);
  });

  it('create for another tenant is refused', async () => {
    await violation(() =>
      asA(() => db.client.create({ data: { tenantId: tenantB, fullName: 'Bad' } })),
    );
  });

  it('createMany and createManyAndReturn stamp every row', async () => {
    const data = [{ fullName: 'x' }, { fullName: 'y' }] as never;
    await asA(() => db.client.createMany({ data }));
    const rows = await asA(() => db.client.createManyAndReturn({ data }));
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
    expect(await base.client.count({ where: { tenantId: tenantB } })).toBe(1);
  });

  it('createMany with one foreign row is refused', async () => {
    await violation(() =>
      asA(() =>
        db.client.createMany({
          data: [{ fullName: 'ok' } as never, { tenantId: tenantB, fullName: 'bad' }],
        }),
      ),
    );
  });

  it('update and delete of another tenant fail', async () => {
    await expect(
      asA(() => db.client.update({ where: { id: clientB }, data: { fullName: 'Hacked' } })),
    ).rejects.toThrow();
    await expect(asA(() => db.client.delete({ where: { id: clientB } }))).rejects.toThrow();
    await unchanged();
  });

  it('updateMany, updateManyAndReturn and deleteMany skip another tenant', async () => {
    const where = { id: clientB };
    const updated = await asA(() => db.client.updateMany({ where, data: { fullName: 'Hacked' } }));
    expect(updated.count).toBe(0);
    expect(
      await asA(() => db.client.updateManyAndReturn({ where, data: { fullName: 'H' } })),
    ).toEqual([]);
    expect((await asA(() => db.client.deleteMany({ where }))).count).toBe(0);
    await unchanged();
  });

  it('an unfiltered deleteMany removes only the current tenant', async () => {
    await base.weddingProject.deleteMany({ where: { tenantId: tenantA } });
    await asA(() => db.client.deleteMany());
    expect(await base.client.count({ where: { tenantId: tenantA } })).toBe(0);
    await unchanged();
  });

  it('moving a row to another tenant is refused', async () => {
    await violation(() =>
      asA(() => db.client.update({ where: { id: clientA }, data: { tenantId: tenantB } })),
    );
    await violation(() =>
      asA(() => db.client.updateMany({ where: { id: clientA }, data: { tenantId: tenantB } })),
    );
  });

  it('upsert on another tenant never changes that row', async () => {
    await expect(
      asA(() =>
        db.client.upsert({
          where: { id: clientB },
          update: { fullName: 'Hacked' },
          create: { id: clientB, fullName: 'Hacked' } as never,
        }),
      ),
    ).rejects.toThrow();
    await unchanged();
  });

  it('upsert within the tenant creates, then updates', async () => {
    const id = randomUUID();
    const args = {
      where: { id },
      update: { fullName: 'Two' },
      create: { id, fullName: 'One' } as never,
    };
    expect((await asA(() => db.client.upsert(args))).fullName).toBe('One');
    expect((await asA(() => db.client.upsert(args))).fullName).toBe('Two');
  });

  it('upsert that moves the tenant is refused', async () => {
    await violation(() =>
      asA(() =>
        db.client.upsert({
          where: { id: clientA },
          update: { tenantId: tenantB },
          create: { fullName: 'x' } as never,
        }),
      ),
    );
  });

  it('models with a composite primary key are scoped too', async () => {
    await base.documentCounter.create({ data: { tenantId: tenantB, key: 'k', value: 5 } });
    const found = await asA(() =>
      db.documentCounter.findUnique({
        where: { tenantId_key: { tenantId: tenantB, key: 'k' } },
      }),
    );
    expect(found).toBeNull();
  });
});

describe('fails closed', () => {
  it('refuses every operation with no tenant context', async () => {
    await violation(() => db.client.findMany());
    await violation(() => db.client.count());
    await violation(() => db.client.create({ data: { fullName: 'x' } as never }));
    await violation(() => db.client.deleteMany());
    await violation(() => db.tenant.findMany());
  });

  it('refuses raw SQL even with a tenant', async () => {
    await violation(() => asA(() => db.$queryRaw`select 1`));
    await violation(() => asA(() => db.$executeRaw`select 1`));
    await violation(() => asA(() => db.$queryRawUnsafe('select 1')));
    await violation(() => asA(() => db.$executeRawUnsafe('select 1')));
  });

  it('refuses an operation it does not know', () => {
    expect(() => scopeOperation('Client', 'findTheFuture', {}, 'a', new Map())).toThrow(
      TenantScopeViolation,
    );
  });

  it('refuses a model it does not know', () => {
    expect(() => scopeOperation('NewModel', 'findMany', {}, 'a', new Map())).toThrow(
      TenantScopeViolation,
    );
  });

  it('refuses cross-tenant models', async () => {
    await violation(() => asA(() => db.user.findMany()));
    await violation(() => asA(() => db.platformAdmin.findMany()));
    await violation(() => asA(() => db.auditLog.findMany()));
  });
});

describe('nested operations', () => {
  it('refuses nested writes in create, update and upsert', async () => {
    const project = { projectNumber: 'P-1', title: 't', priceCentavos: 1 };
    await violation(() =>
      asA(() =>
        db.client.create({
          data: { fullName: 'x', projects: { create: project } } as never,
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.client.update({
          where: { id: clientA },
          data: { projects: { deleteMany: {} } },
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.client.upsert({
          where: { id: clientA },
          update: { projects: { deleteMany: {} } },
          create: { fullName: 'x' } as never,
        }),
      ),
    );
  });

  it('refuses a nested connect to another tenant', async () => {
    await violation(() =>
      asA(() =>
        db.weddingProject.create({
          data: {
            projectNumber: 'P-2',
            title: 't',
            priceCentavos: 1,
            client: { connect: { tenantId_id: { tenantId: tenantB, id: clientB } } },
          } as never,
        }),
      ),
    );
  });

  it('allows includes that stay inside the tenant', async () => {
    const rows = await asA(() =>
      db.tenantMembership.findMany({ include: { user: { select: { email: true } } } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user.email).toContain('@');
  });

  it('refuses traversal through User to other tenants', async () => {
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({ include: { user: { include: { memberships: true } } } }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({
          select: { user: { select: { memberships: { select: { tenantId: true } } } } },
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({
          select: { user: { select: { _count: { select: { memberships: true } } } } },
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({
          where: { user: { memberships: { some: { tenantId: tenantB } } } },
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({
          where: { OR: [{ user: { is: { memberships: { some: { role: 'owner' } } } } }] },
        }),
      ),
    );
    await violation(() =>
      asA(() =>
        db.tenantMembership.findMany({ orderBy: { user: { memberships: { _count: 'desc' } } } }),
      ),
    );
  });
});

describe('the Tenant model', () => {
  it('exposes only the current tenant', async () => {
    const rows = await asA(() => db.tenant.findMany({ where: { id: { in: [tenantA, tenantB] } } }));
    expect(rows.map((r) => r.id)).toEqual([tenantA]);
    expect(await asA(() => db.tenant.findUnique({ where: { id: tenantB } }))).toEqual(
      expect.objectContaining({ id: tenantA }),
    );
  });

  it('updates only the current tenant', async () => {
    await asA(() => db.tenant.update({ where: { id: tenantB }, data: { name: 'Renamed' } }));
    expect((await base.tenant.findUniqueOrThrow({ where: { id: tenantB } })).name).toBe('B');
    expect((await base.tenant.findUniqueOrThrow({ where: { id: tenantA } })).name).toBe('Renamed');
  });

  it('refuses create, delete and id changes', async () => {
    await violation(() => asA(() => db.tenant.create({ data: { slug: 'x', name: 'x' } })));
    await violation(() => asA(() => db.tenant.delete({ where: { id: tenantA } })));
    await violation(() =>
      asA(() => db.tenant.update({ where: { id: tenantA }, data: { id: tenantB } })),
    );
  });
});

describe('context handling', () => {
  it('keeps concurrent requests apart', async () => {
    const list = (tenant: string) =>
      context.run(tenant, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return (await db.client.findMany({ where: { id: { in: [clientA, clientB] } } }))[0]!.id;
      });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? list(tenantA) : list(tenantB))),
    );
    results.forEach((id, i) => expect(id).toBe(i % 2 ? clientA : clientB));
  });

  it('uses the context at await time, so a query escaping its context is refused', async () => {
    const escaped = context.run(tenantA, () => db.client.findMany());
    await violation(() => escaped);
  });

  it('applies inside interactive and batch transactions', async () => {
    const seen = await asA(() =>
      db.$transaction((tx) => tx.client.findMany({ where: { id: { in: [clientA, clientB] } } })),
    );
    expect(seen.map((r) => r.id)).toEqual([clientA]);

    const [count] = await asA(() =>
      db.$transaction([db.client.count({ where: { id: { in: [clientA, clientB] } } })]),
    );
    expect(count).toBe(1);
  });
});

describe('composite foreign keys, at the database', () => {
  const project = (tenantId: string, clientId: string, number: string) =>
    `INSERT INTO wedding_projects (id, tenant_id, client_id, project_number, title, price_centavos, updated_at)
     VALUES ('${randomUUID()}', '${tenantId}', '${clientId}', '${number}', 't', 1, now())`;

  it('refuse a project pointing at another tenant, from raw SQL', async () => {
    await expect(base.$executeRawUnsafe(project(tenantA, clientB, 'X-1'))).rejects.toThrow();
    await expect(base.$executeRawUnsafe(project(tenantA, clientA, 'X-2'))).resolves.toBe(1);
  });

  it('refuse a scalar clientId from another tenant on the scoped client', async () => {
    await expect(
      asA(() =>
        db.weddingProject.create({
          data: { clientId: clientB, projectNumber: 'X-3', title: 't', priceCentavos: 1 } as never,
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuse deleting a client that still has projects', async () => {
    await base.$executeRawUnsafe(project(tenantA, clientA, 'X-4'));
    await expect(base.client.delete({ where: { id: clientA } })).rejects.toThrow();
  });

  it('refuse a negative price', async () => {
    await expect(
      base.weddingProject.create({
        data: {
          tenantId: tenantA,
          clientId: clientA,
          projectNumber: 'X-5',
          title: 't',
          priceCentavos: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it('refuse a media key outside the tenant folder', async () => {
    await expect(
      base.mediaFile.create({
        data: {
          tenantId: tenantA,
          bucket: 'private_media',
          objectKey: `${tenantB}/sketch/x.png`,
          purpose: 'sketch',
          mimeType: 'image/png',
          sizeBytes: 1,
          uploadedByUserId: userA,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('registry', () => {
  const models = () =>
    (
      base as unknown as {
        _runtimeDataModel: { models: Record<string, { fields: { name: string }[] }> };
      }
    )._runtimeDataModel.models;

  it('classifies every model exactly once', () => {
    for (const name of Object.keys(models())) {
      const places =
        Number(TENANT_MODELS.has(name)) +
        Number(CROSS_TENANT_MODELS.has(name)) +
        Number(name === SELF_SCOPED_MODEL);
      expect(places, name).toBe(1);
    }
  });

  it('registers every model with tenantId; AuditLog is the one named exception', () => {
    const withTenant = Object.entries(models())
      .filter(([, model]) => model.fields.some((field) => field.name === 'tenantId'))
      .map(([name]) => name);
    expect(withTenant.filter((name) => !TENANT_MODELS.has(name))).toEqual(['AuditLog']);
    expect([...TENANT_MODELS].filter((name) => !withTenant.includes(name))).toEqual([]);
  });
});

describe('database security audit', () => {
  let admin: PgClient;
  beforeAll(async () => {
    admin = new PgClient({ connectionString: ADMIN_TEST_URL });
    await admin.connect();
  });
  afterAll(() => admin.end());

  it('has RLS enabled on every table, including _prisma_migrations', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('has no RLS policies', async () => {
    const { rows } = await admin.query(`SELECT * FROM pg_policies WHERE schemaname = 'public'`);
    expect(rows).toEqual([]);
  });

  it('gives Supabase API roles no table access', async () => {
    const { rows } = await admin.query(
      `SELECT grantee, table_name FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    );
    expect(rows).toEqual([]);
  });

  it.each(['anon', 'authenticated'])('denies %s at the database', async (role) => {
    await admin.query('BEGIN');
    await admin.query(`SET LOCAL ROLE ${role}`);
    await expect(admin.query('SELECT * FROM tenants')).rejects.toThrow(/permission denied/);
    await admin.query('ROLLBACK');
  });

  it('uses tenant_id in every foreign key between tenant-owned tables', async () => {
    const { rows } = await admin.query(
      `SELECT con.conname FROM pg_constraint con
       JOIN pg_attribute child ON child.attrelid = con.conrelid AND child.attname = 'tenant_id'
       JOIN pg_attribute parent ON parent.attrelid = con.confrelid AND parent.attname = 'tenant_id'
       WHERE con.contype = 'f' AND NOT child.attnum = ANY (con.conkey)`,
    );
    expect(rows).toEqual([]);
  });

  it('has a unique (tenant_id, id) on every tenant-owned table with an id', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute t ON t.attrelid = c.oid AND t.attname = 'tenant_id' AND t.attnotnull
       JOIN pg_attribute i ON i.attrelid = c.oid AND i.attname = 'id'
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (
         SELECT 1 FROM pg_index x WHERE x.indrelid = c.oid AND x.indisunique
           AND x.indkey::int2[] @> ARRAY[t.attnum, i.attnum] AND x.indnatts = 2
       )`,
    );
    expect(rows).toEqual([]);
  });

  it('runs the API role without superuser or DDL rights', async () => {
    const { rows } = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'tahi_api'`,
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: true,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    await expect(base.$executeRawUnsafe('CREATE TABLE nope (id int)')).rejects.toThrow();
    await expect(base.$executeRawUnsafe('DROP TABLE clients')).rejects.toThrow();
  });
});
