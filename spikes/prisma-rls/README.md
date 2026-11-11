# Spike: Prisma 7 + PostgreSQL RLS (risk R1)

Throwaway code that backs **ADR-018**. It is not part of the workspace build, lint or tests. The production version goes into `packages/database` and `apps/api/src/core/database`.

- `setup.sql`: tables `tenant`, `client` (RLS enabled and forced) and `client_norls` (baseline), with 50 tenants × 2,000 clients.
- `lib.ts`: the tenant-scoped extension (per-operation batch transaction), `withTenantTx` and the `db()` accessor.
- `verify.ts`: 15 correctness checks (fail-closed, foreign ids, WITH CHECK, concurrency leakage, rollback, nesting).
- `bench.ts`: baseline vs per-operation vs per-request transaction.

## Run (local PostgreSQL 18, non-superuser role)
```bash
createdb tahi_spike
psql -d tahi_spike -f spikes/prisma-rls/setup.sql
cd spikes/prisma-rls
../../node_modules/.bin/prisma generate --config prisma.config.ts
export DATABASE_URL="postgresql://$USER@localhost/tahi_spike?host=/var/run/postgresql"
node verify.ts
node bench.ts
```
Node 24 runs the `.ts` files directly (type stripping). Results are recorded in ADR-018.
