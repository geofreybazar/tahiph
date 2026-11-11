// Latency/throughput of three access strategies for a typical request
// (1 list of 20 rows + 4 point lookups by id).
import { performance } from 'node:perf_hooks';
import { als, createBase, createScoped, db, withTenantTx } from './lib.ts';

const POOL = 10;
const REQUESTS = Number(process.env.REQUESTS ?? 2000);
const base = createBase(POOL);
const scoped = createScoped(base);

const tenants = (await base.tenant.findMany({ select: { id: true } })).map((t) => t.id);
// 20 known ids per tenant for point lookups.
const ids = new Map<string, string[]>();
for (const t of tenants) {
  const rows = await base.clientNoRls.findMany({
    where: { tenantId: t },
    select: { id: true },
    take: 20,
  });
  ids.set(
    t,
    rows.map((r) => r.id),
  );
}

type Strategy = (tenantId: string, pick: string[]) => Promise<void>;

const strategies: Record<string, Strategy> = {
  // No RLS, explicit tenant filter: the floor.
  baseline: async (tenantId, pick) => {
    await base.clientNoRls.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, take: 20 });
    for (const id of pick) await base.clientNoRls.findFirst({ where: { tenantId, id } });
  },
  // RLS + extension, one batch transaction per operation.
  perOperation: (tenantId, pick) =>
    als.run({ tenantId }, async () => {
      await scoped.client.findMany({ orderBy: { name: 'asc' }, take: 20 });
      for (const id of pick) await scoped.client.findFirst({ where: { id } });
    }),
  // RLS + extension, one interactive transaction for the whole request.
  perRequestTx: (tenantId, pick) =>
    als.run({ tenantId }, () =>
      withTenantTx(scoped, async () => {
        const c = db(scoped);
        await c.client.findMany({ orderBy: { name: 'asc' }, take: 20 });
        for (const id of pick) await c.client.findFirst({ where: { id } });
      }),
    ),
};

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function run(name: string, fn: Strategy, concurrency: number, n: number) {
  const lat: number[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < n) {
        const i = next++;
        const t = tenants[i % tenants.length]!;
        const pool = ids.get(t)!;
        const pick = [0, 1, 2, 3].map((k) => pool[(i + k * 5) % pool.length]!);
        const s = performance.now();
        await fn(t, pick);
        lat.push(performance.now() - s);
      }
    }),
  );
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  return {
    strategy: name,
    concurrency,
    'p50 ms': pct(lat, 50).toFixed(2),
    'p95 ms': pct(lat, 95).toFixed(2),
    'p99 ms': pct(lat, 99).toFixed(2),
    'req/s': Math.round((n / wall) * 1000),
  };
}

const rows = [];
for (const concurrency of [1, 16]) {
  for (const [name, fn] of Object.entries(strategies)) {
    await run(name, fn, concurrency, 200); // warm-up
    rows.push(await run(name, fn, concurrency, REQUESTS));
  }
}
console.table(rows);
await base.$disconnect();
