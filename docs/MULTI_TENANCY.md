# Multi-Tenancy — TAHI.ph

> **Status:** Phase 2 in progress. **Implemented:** layers 1–4 for the identity and tenancy tables, the scoped client (`packages/database/src/tenancy`), the access guard and the RLS test suite (ADR-018, ADR-019).

## 1. Model

**Shared database, shared schema.** Every tenant-owned row carries `tenant_id UUID NOT NULL`. Isolation is enforced in **four independent layers**, so a bug in one layer does not leak data.

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Context resolution | Tenant derived server-side from session or Host; never from client input | Forged `tenantId` in body/query/header |
| 2. Scoped data access | Prisma client extension auto-filters and auto-stamps `tenant_id` | Developer forgets a `where tenantId` |
| 3. Row-Level Security | PostgreSQL policies keyed on `app.tenant_id` | Raw SQL, extension bypass, ORM bugs |
| 4. Composite foreign keys | `(tenant_id, x_id) → x(tenant_id, id)` | Cross-tenant references (e.g. an order pointing to another tenant's client) |

Plus **automated cross-tenant tests** in CI (section 7).

## 2. Platform vs tenant data

| Category | Examples | `tenant_id` | RLS |
|---|---|---|---|
| Platform-global | `PlatformUser`, `SubscriptionPlan`, `PlatformSetting`, `AuditLog` | — | No (not reachable by the tenant role) |
| Identity (global) | `User`, `Session` | — | No; access only by own id |
| Tenant registry | `Tenant`, `TenantDomain`, `Subscription`, `SubscriptionInvoice`, `PlatformTransaction` | `Tenant.id` / FK | Read-only to the owning tenant via dedicated endpoints |
| Tenant-owned | `Client`, `Order`, `Appointment`, `OrderPayment`, … | Yes | **Yes, FORCE** |
| Bridge | `TenantMembership` | Yes | Yes |

`Subscription` and `PlatformTransaction` belong to TAHI's ledger even though they reference a tenant. Tenants can see their own billing history but never modify it.

## 3. Tenant resolution

The global `AccessGuard` (`apps/api/src/core/auth/access.guard.ts`) resolves the realm and tenant and fills the CLS `RequestContext` (`apps/api/src/core/context/request-context.ts`). It runs in the guard, not in middleware, because it needs the route's realm metadata. In outline:

```ts
type RequestContext = {
  requestId: string;
  realm: 'platform' | 'tenant' | 'public' | 'customer';
  tenantId?: string;          // set only by this middleware / session guard
  userId?: string;            // tenant staff User or PlatformUser
  membershipId?: string;
  customerAccountId?: string;
  permissions: ReadonlySet<Permission>;
};
```

| Realm | Host | How `tenantId` is determined |
|---|---|---|
| tenant | `app.tahi.ph` | From the session's `activeMembershipId`. The membership must be `ACTIVE` and its tenant `ACTIVE`/`TRIAL`. Switching ateliers is `POST /api/v1/tenant/session/switch`, which re-validates the membership. |
| public / customer | `{slug}.tahi.ph` or custom domain | `Host` → `TenantDomain(hostname)`, verified, tenant online. One indexed lookup per request; not cached yet (ADR-019). Unknown host → 404. |
| platform | `admin.tahi.ph` | None. Cross-tenant operations specify the tenant **in the URL** and pass a `platform.tenants.access` permission check plus an audit write. |

- **Hard rule:** no DTO schema in `packages/validation` contains a `tenantId` field for tenant-realm endpoints. A lint rule enforces this.
- A customer session is bound to a single tenant. A customer cookie presented on another tenant's host is rejected.

## 4. Scoped data access (Prisma)

```ts
// packages/database — illustrative; the spike-validated version is in spikes/prisma-rls/lib.ts (ADR-018)
export const TENANT_MODELS = new Set<Prisma.ModelName>([...]); // generated list

prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const tenantId = cls.get('tenantId');
        if (!tenantId) throw new MissingTenantContextError(model, operation);
        // inject into where / data / create, reject explicit mismatching tenantId
        return runWithRls(tenantId, () => query(scope(args, tenantId, operation)));
      },
    },
  },
});
```

Rules:
- The API injects only the **tenant-scoped client**. The unscoped client is available only to `TenantsModule`, `AuthModule` and platform modules, through an explicitly named provider (`UNSCOPED_PRISMA`). Its usage is grep-auditable.
- `findUnique` by id is rewritten to `findFirst({ id, tenantId })`, or the composite unique `(tenant_id, id)` is used.
- Missing tenant context on a tenant model is a **hard error**, never a silent empty result.
- Raw SQL (`$queryRaw`) is allowed only inside `withTenantTx`, via `db()`.

## 5. PostgreSQL Row-Level Security

### Roles
| Role | Used by | Privileges |
|---|---|---|
| `tahi_owner` | Migrations (one-shot `migrate` job) | Owns schema and tables |
| `tahi_app` | api, worker | DML on tables. **Not owner, not superuser, `NOBYPASSRLS`.** |
| `tahi_platform` | Platform admin cross-tenant reads (Phase 7) | Policy allows all tenants; every use is audited at the app level |
| `tahi_backup` | Backup job | Read-only, `BYPASSRLS` for dumps |

### Policy (per tenant table)
```sql
ALTER TABLE client ENABLE ROW LEVEL SECURITY;
ALTER TABLE client FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client
  USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```
If `app.tenant_id` is unset, the expression is NULL and the policy matches **no rows**, so the failure is closed. The `nullif` is required: once a pooled connection has seen the setting, its unset value is `''`, and a bare `''::uuid` cast raises an error (found in the Phase 2 spike, ADR-018).

### Setting the context
Each tenant-scoped operation runs inside a transaction that first executes:
```sql
SELECT set_config('app.tenant_id', $1, true);  -- true = transaction-local (SET LOCAL)
```
- Transaction-local settings are safe with connection pooling (including PgBouncer in transaction mode).
- By default the scoped client wraps **each operation** in a batch transaction (`BEGIN; set_config; query; COMMIT`).
- Multi-statement units of work use `withTenantTx(fn)`. It sets the config once and publishes the transaction client in the CLS context; nested calls join it. No external I/O inside.
- Services obtain the client through `db()`: the ambient transaction if one is open, else the scoped client. Services never call `prisma.$transaction` directly.
- Prisma queries are lazy (they run on `await`), so context helpers must await inside the context. Otherwise the query fails with `MissingTenantContextError`.

### Measured trade-off (Risk R1, ADR-018)
The Phase 2 spike measured about 3× the latency of an unprotected query for per-operation transactions (3.5 ms vs 1.2 ms for a five-query request locally), and about 1.4× with one transaction per unit of work. Both are acceptable at TAHI's scale, so RLS stays on for reads and writes. Re-measure on the VPS in Phase 8.

RLS policies are maintained as raw SQL in Prisma migrations, plus a CI check that fails if any table with a `tenant_id` column lacks an enabled-and-forced policy.

## 6. Composite keys and uniqueness

- Every tenant table has `UNIQUE (tenant_id, id)`, which is what composite FKs reference.
- Child relations use composite FKs, e.g.:
  ```sql
  FOREIGN KEY (tenant_id, client_id) REFERENCES client (tenant_id, id)
  ```
  In Prisma: `client Client @relation(fields: [tenantId, clientId], references: [tenantId, id])`.
- Business uniques are tenant-scoped: `(tenant_id, order_number)`, `(tenant_id, email)` on clients (partial, where not archived), `(tenant_id, slug)` on products.
- Every index on a tenant table leads with `tenant_id`.

## 7. Cross-tenant test suite (mandatory, CI)

**Implemented** (`apps/api/test/cross-tenant.int.spec.ts`), driven by the route inventory:
- Any tenant, customer or public route whose path params or uuid body fields are not declared with `@References()` fails the suite.
- Each reference is sent with another atelier's id. The suite expects 404, checks that the victim atelier's rows are unchanged, and runs a positive control with the actor's own id.
- Customer and public realms join when their first referencing routes exist.

1. Fixture: tenants **A** and **B**, each with an owner, a staff member, a client, an order, an appointment and a payment.
2. For **every** tenant-realm route (enumerated from the Nest router at test time, so new routes are covered automatically):
   - Acting as A, access B's resource ids. Expect **404** (existence is not disclosed).
   - Acting as A, `POST`/`PATCH` with B's ids in the body (e.g. `clientId`). Expect 404/422, and assert nothing was written.
3. Storefront: request A's resource ids via B's host. Expect 404.
4. RLS: connect as `tahi_app`, run raw `SELECT` without `app.tenant_id`. Expect 0 rows. With A's id, expect only A's rows. An insert with a mismatched `tenant_id` is rejected.
5. Worker: enqueue a job for A that references B's id. Expect a not-found failure.
6. Lint/static checks:
   - no `tenantId` in tenant DTOs;
   - `UNSCOPED_PRISMA` imported only in allow-listed modules;
   - every tenant table has an RLS policy.

## 8. Background jobs

```ts
abstract class TenantJobProcessor<T extends { tenantId: string }> {
  async process(job: Job<T>) {
    return this.cls.run(async () => {
      this.cls.set('tenantId', job.data.tenantId);   // re-validated: tenant exists & active
      this.cls.set('realm', 'tenant');
      return this.handle(job);
    });
  }
}
```

**Implemented (ADR-029):** `TenantJobRunner` (`apps/api/src/core/tenancy/tenant-job-runner.ts`) does this as an injectable runner: `runner.run(tenantId, fn)`. Platform jobs list tenants with `operationalTenantIds()` and fan out one job per tenant.

## 9. Tenant lifecycle

`PENDING_APPROVAL → TRIAL → ACTIVE ⇄ PAST_DUE → SUSPENDED → (CANCELLED) → ARCHIVED`

| State | Dashboard | Storefront | API writes |
|---|---|---|---|
| PENDING_APPROVAL | Onboarding only | Offline | Onboarding only |
| TRIAL / ACTIVE | Full | Online | Yes |
| PAST_DUE | Full + banner (grace period) | Online | Yes |
| SUSPENDED | Read-only + billing page | "Temporarily unavailable" page | Billing only |
| CANCELLED | Data export only | Offline | No |
| ARCHIVED | — | — | Data retained per retention policy, then anonymized/purged |

Status is checked in the session guard, cached briefly in Redis, and invalidated on change.
