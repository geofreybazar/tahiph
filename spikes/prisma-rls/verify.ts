// Correctness checks for the spike design. Exits non-zero on the first failure.
import { randomUUID } from 'node:crypto';
import {
  als,
  createBase,
  createScoped,
  db,
  MissingTenantContextError,
  withTenantTx,
} from './lib.ts';

const base = createBase(10);
const scoped = createScoped(base);
let passed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (!ok) {
    console.error(`FAIL ${name} ${detail}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${name}`);
}

async function rejects(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split('\n').slice(-1)[0]! : String(e);
  }
}

const tenants = await base.tenant.findMany({ select: { id: true }, take: 50 });
const [A, B] = [tenants[0]!.id, tenants[1]!.id];
const bClient = await als.run({ tenantId: B }, async () => await scoped.client.findFirst());

// 1. Foreign id under A's context is invisible (would become a 404).
const leak = await als.run(
  { tenantId: A },
  async () => await scoped.client.findFirst({ where: { id: bClient!.id } }),
);
check('foreign id returns null', leak === null);

// 2. No context: hard error, not an empty result.
const noCtx = await rejects(scoped.client.findMany({ take: 1 }));
check(
  'missing context throws',
  noCtx !== null && noCtx.includes('Tenant context missing'),
  noCtx ?? '',
);
void MissingTenantContextError;

// 3. Bypassing the extension (base client, raw SQL) without the setting: RLS returns 0 rows.
const rawCount = await base.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM client`;
check('raw SQL without setting sees 0 rows', rawCount[0]!.n === 0n);
const baseCount = await base.client.count();
check('unscoped Prisma client sees 0 rows', baseCount === 0);

// 4. WITH CHECK: insert for B while the setting says A is rejected by Postgres.
const crossInsert = await rejects(
  base.$transaction([
    base.$executeRaw`SELECT set_config('app.tenant_id', ${A}, true)`,
    base.client.create({ data: { id: randomUUID(), tenantId: B, name: 'x', email: 'x@x' } }),
  ]),
);
check('RLS WITH CHECK blocks cross-tenant insert', crossInsert !== null, crossInsert ?? '');

// 5. Extension rejects an explicit mismatching tenantId in data.
const stamp = await rejects(
  als.run(
    { tenantId: A },
    async () =>
      await scoped.client.create({
        data: { id: randomUUID(), tenantId: B, name: 'x', email: 'x@x' },
      }),
  ),
);
check('extension rejects mismatching tenantId', stamp !== null);

// 6. No context leakage across pooled connections under concurrency.
const ops = Array.from({ length: 3000 }, (_, i) => {
  const t = tenants[i % tenants.length]!.id;
  return als.run({ tenantId: t }, async () => {
    const rows = await scoped.client.findMany({ take: 5, orderBy: { name: 'asc' } });
    return rows.every((r) => r.tenantId === t) && rows.length === 5;
  });
});
const results = await Promise.all(ops);
check('3000 concurrent scoped ops: no cross-tenant rows', results.every(Boolean));
const after = await base.client.count();
check('setting does not persist on pooled connections', after === 0);

// 7. Interactive transaction: atomic, scoped, rolls back on error.
const newId = randomUUID();
const txErr = await rejects(
  als.run({ tenantId: A }, () =>
    withTenantTx(scoped, async () => {
      const tx = db(scoped);
      await tx.client.create({ data: { id: newId, name: 'tx', email: 'tx@x' } as never });
      const seen = await tx.client.findFirst({ where: { id: newId } });
      if (!seen || seen.tenantId !== A) throw new Error('not visible in tx');
      throw new Error('force rollback');
    }),
  ),
);
check('interactive tx error propagates', txErr === 'force rollback', txErr ?? '');
const rolledBack = await als.run(
  { tenantId: A },
  async () => await scoped.client.findFirst({ where: { id: newId } }),
);
check('interactive tx rolled back', rolledBack === null);

const committed = await als.run({ tenantId: A }, () =>
  withTenantTx(scoped, async () => {
    const tx = db(scoped);
    await tx.client.create({ data: { id: newId, name: 'tx', email: 'tx@x' } as never });
    return tx.client.count();
  }),
);
check('interactive tx commits and counts own tenant only', committed === 2001, String(committed));
await als.run({ tenantId: A }, async () => await scoped.client.delete({ where: { id: newId } }));

// 8. Delete/update of a foreign id affects nothing.
const foreignUpdate = await als.run(
  { tenantId: A },
  async () =>
    await scoped.client.updateMany({ where: { id: bClient!.id }, data: { name: 'pwned' } }),
);
check('updateMany on foreign id affects 0 rows', foreignUpdate.count === 0);
const foreignDelete = await rejects(
  als.run({ tenantId: A }, async () => await scoped.client.delete({ where: { id: bClient!.id } })),
);
check('delete on foreign id fails (P2025 -> 404)', foreignDelete !== null);

// 9. db() inside a transaction is the transaction (sees its own uncommitted write);
//    nested withTenantTx joins it; outside, the write was rolled back.
const nestedId = randomUUID();
const nested = await rejects(
  als.run({ tenantId: A }, () =>
    withTenantTx(scoped, async () => {
      await db(scoped).client.create({ data: { id: nestedId, name: 'n', email: 'n@x' } as never });
      const inner = await withTenantTx(scoped, async () => await db(scoped).client.count());
      if (inner !== 2001) throw new Error(`inner count ${inner}`);
      throw new Error('rollback');
    }),
  ),
);
check('nested withTenantTx joins the outer transaction', nested === 'rollback', nested ?? '');
const gone = await als.run(
  { tenantId: A },
  async () => await scoped.client.findFirst({ where: { id: nestedId } }),
);
check('nested write rolled back with the outer transaction', gone === null);

console.log(`\n${passed} checks passed`);
await base.$disconnect();
