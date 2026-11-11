# Architectural Decision Records — TAHI.ph

> Format: Context → Decision → Consequences. Status values: **Proposed**, **Accepted**, **Superseded**.
> Decisions marked *(PO-confirmed)* were chosen by the product owner during Phase 0 discovery and remain open to final architecture approval.

---

## ADR-001 — Traefik as reverse proxy *(PO-confirmed)*
**Status:** Accepted (2026-11-11)
**Context:** The brief listed both Nginx and Traefik. Tenant subdomains are dynamic and services are Docker containers.
**Decision:** Traefik v3, with Docker-label routing (via a socket proxy) and ACME DNS-01 via Cloudflare for `*.tahi.ph`. Nginx is not used.
**Consequences:** Automatic certificates and routing without per-host config files. The team must learn Traefik's router priority model. Custom-domain TLS is delegated to Cloudflare for SaaS (ADR-008), not Traefik.

## ADR-002 — Opaque server-side sessions instead of JWT *(PO-confirmed)*
**Status:** Accepted (2026-11-11)
**Context:** Browser-only clients; requirements for instant suspension and session invalidation; three realms.
**Decision:** 256-bit random tokens in `__Host-` HttpOnly cookies, SHA-256 hashes in `Session`, Redis cache (60 s). No JWTs for browser auth.
**Consequences:**
- Immediate revocation and simple logout-everywhere.
- A DB/Redis lookup per request (cheap).
- Native mobile apps would later need a token flow (a separate ADR).
- The brief's "refresh token rotation" maps to token rotation on privilege change.

## ADR-003 — Split dashboard and storefront into separate Next.js apps *(PO-confirmed)*
**Status:** Accepted (2026-11-11)
**Context:** The brief had both in `apps/web`.
**Decision:** `apps/dashboard` (authenticated, `app.tahi.ph`) and `apps/storefront` (public, Host-resolved, ISR).
**Consequences:**
- Separate CSP, caching and bundles.
- Smaller blast radius.
- Storefront can deploy independently.
- One more image and container. Shared UI goes through `packages/ui`.

## ADR-004 — PayMongo Platforms for tenant customer payments *(PO-confirmed, pending provider verification)*
**Status:** Proposed. Becomes Accepted once PayMongo questions P1–P9 are answered.
**Context:** Tenant customer money must belong to tenants. TAHI's only revenue is subscriptions; it takes **no cut of tenant sales** (PO decision, 2026-11-11). PayMongo publicly documents child accounts (Accounts API) and split payments.
**Decision:**
- Each tenant becomes a PayMongo child account under TAHI's platform account.
- 100% of each payment routes to the child account. PayMongo's platform-fee feature is not used.
- Fallback: the tenant supplies its own PayMongo keys (encrypted).
- Manual payments are always available.
**Consequences:**
- TAHI is not the merchant of record for tenant sales.
- Exactly two ledgers: SaaS subscriptions (TAHI) and customer payments (tenant).
- Because TAHI earns nothing on these payments, Platforms is a cost purely for onboarding convenience. If its pricing is high, OWN_KEYS becomes the primary mode (question P10).
- Dependent on PayMongo approval and child KYC feasibility for small ateliers.

## ADR-005 — Shared schema multi-tenancy with layered isolation
**Status:** Proposed
**Decision:**
- `tenant_id` on all tenant tables.
- Server-side tenant resolution.
- Prisma extension for automatic scoping.
- PostgreSQL RLS (`FORCE`, non-owner app role).
- Composite `(tenant_id, id)` foreign keys.
- CI cross-tenant suite.
**Consequences:** Strong isolation at low operational cost. RLS + Prisma adds a per-operation transaction (risk R1, Phase 2 spike).

## ADR-006 — UUIDv7 primary keys + per-tenant human numbers
**Status:** Proposed
**Decision:** UUIDv7 for all PKs. `TenantCounter` for human-readable numbers.
**Consequences:** Non-enumerable ids, good index locality, ids generatable in-app. Numbers are gap-free per tenant per year, at the cost of a row lock on creation.

## ADR-007 — Zod as the single contract language
**Status:** Proposed
**Decision:**
- Request/response schemas live in `packages/validation`.
- The NestJS global Zod pipe validates.
- OpenAPI is generated from the same schemas.
- class-validator is not used.
**Consequences:** One source of truth shared with React Hook Form. The OpenAPI generator library is chosen in Phase 1 after a compatibility check.

## ADR-008 — Custom domains via Cloudflare for SaaS
**Status:** Proposed (implemented in Phase 5+)
**Decision:** Tenant custom domains CNAME to `customers.tahi.ph`. Cloudflare Custom Hostnames handles TLS issuance and renewal.
**Consequences:** No per-domain ACME on the VPS and no rate-limit risk. Cloudflare for SaaS cost per hostname beyond the free allotment.

## ADR-009 — Worker as a second entrypoint of the API codebase
**Status:** Proposed
**Context:** The brief listed `apps/worker` and allows the worker to share API code initially, but it must run separately.
**Decision:** `apps/api/src/main.worker.ts` builds a Nest application context with the domain modules (no controllers). Same image, different command, separate container.
**Consequences:**
- No duplicated business logic and no cross-app imports.
- The worker scales and restarts independently.
- Extract to `packages/domain` + `apps/worker` later if needed.

## ADR-010 — S3-compatible object storage (Cloudflare R2 recommended)
**Status:** Proposed
**Decision:** An S3 API abstraction with presigned uploads. R2 is preferred (no egress fees; already on Cloudflare). Cloudinary is not used initially; image transforms come from `next/image` plus worker-side resizing.
**Consequences:** No vendor lock-in (an S3-compatible local store — chosen in Phase 3 — and R2 in production). We forgo Cloudinary's on-the-fly transformations.

## ADR-011 — npm workspaces declared in `package.json`
**Status:** Proposed
**Decision:** `"workspaces": ["apps/*","packages/*"]` in the root `package.json`, plus Turborepo. The brief's `npm-workspace.yaml` (a pnpm convention) is dropped.

## ADR-012 — Modular monolith API
**Status:** Proposed
**Decision:** One NestJS deployable organized by domain modules, with enforced dependency rules and no cycles. No microservices.
**Consequences:** Simple operations and transactions. Modules can be extracted later if a real scaling need appears.

## ADR-013 — In-house SaaS billing engine
**Status:** Proposed
**Decision:** TAHI generates subscription invoices and drives dunning via worker jobs. PayMongo checkout is used per invoice. There is no dependency on provider-side recurring billing.
**Consequences:** Full control over trials, proration and grace periods, at the cost of more code to build and test.

---

## ADR-014 — Phase 1 toolchain pins
**Status:** Accepted (2026-11-11)
**Context:** Versions were checked against the npm registry and peer dependencies on 2026-11-11.

| Tool | Pinned | Why not latest |
|---|---|---|
| Node.js | 24.x LTS (`.nvmrc`, image `node:24.22.1-alpine`) | — |
| TypeScript | 6.0.3 | 7.0 (native port) is latest, but `typescript-eslint` 8.72 requires `<6.1` |
| Prisma | 7.10.1 + `@prisma/adapter-pg` | npm's `latest` dist-tag points to `8.0.0-rc.33`, a release candidate |
| ESLint | 9.39.5 | ESLint 10 is current and 9 is flagged unsupported, but `eslint-plugin-react`, `-import` and `-jsx-a11y` (used by `eslint-config-next` 16) do not support 10 yet. Tracked as risk R17. |
| Next.js / React | 16.4.6 / 19.3.1 | — |
| NestJS | 12.4.2 | — |
| Zod | 4.6.7 | — |
| Vitest | 5.1.0 (+ `unplugin-swc` for decorator metadata) | — |
| Turborepo | 2.11.10 | — |
| PostgreSQL / Redis | 18 / 8 (Alpine images) | — |

All versions are pinned exactly (no ranges) in `package.json` files.

**Install scripts:** npm 11's `allowScripts` approves only `prisma`, `@prisma/engines` and `@swc/core`, after their scripts were reviewed. `msgpackr-extract` (an optional native build) is denied, and BullMQ uses its pure-JS fallback.

## ADR-015 — ESM backend; in-house Zod pipe; OpenAPI generator deferred
**Status:** Accepted (2026-11-11)
**Context:** NestJS 12 ships as ESM only. `nestjs-zod` (the candidate in ADR-007) declares peers only up to NestJS 11.
**Decision:**
- All packages and the API are ESM (`"type": "module"`, `NodeNext`, `.js` import suffixes).
- The API uses a small in-house `ZodValidationPipe` instead of `nestjs-zod`.
- `@nestjs/config` is not used either. Env is validated by a Zod schema in `core/config/env.ts`, which keeps a single validation library.
- The OpenAPI/Swagger generator is chosen in Phase 2 alongside the first real endpoints.
**Consequences:** Fewer dependencies and no version-lag risk. A small amount of glue code is ours to maintain.

## ADR-016 — No MinIO for local object storage
**Status:** Accepted (2026-11-11)
**Context:** MinIO stopped publishing community Docker images in 2025, and nothing needs object storage before uploads (Phase 3).
**Decision:** Local S3 emulation is omitted from Phase 1. An S3-compatible local option is evaluated in Phase 3.

## ADR-017 — Library build layout (`tsconfig.json` vs `tsconfig.build.json`)
**Status:** Accepted (2026-11-11)
**Decision:** In each package, `tsconfig.json` (noEmit) covers all sources including tests and is used by the editor, `tsc` typecheck and type-aware ESLint. `tsconfig.build.json` emits `dist/` and excludes specs. Internal packages are consumed as built ESM from `dist/` (Turborepo `^build` ordering), so the API runs plain Node without path aliases.

## ADR-018 — Tenant data access strategy: RLS on every path, per-operation transactions by default
**Status:** Accepted (2026-11-11, Phase 2 spike; approved by the product owner)
**Context:** Risk R1. Prisma has no hook to set `app.tenant_id` on a connection, so every RLS-protected query must run in a transaction that calls `set_config(..., true)` first. The spike (`spikes/prisma-rls/`) measured the cost and tested correctness against PostgreSQL 18 with Prisma 7.10.1 and `@prisma/adapter-pg`.
**Results** (local Unix socket, pool of 10; one request = 1 list of 20 rows + 4 lookups by id; two runs agreed within 2%):

| Strategy | p50 at c=1 | p95 at c=16 | req/s at c=16 |
|---|---|---|---|
| Baseline: no RLS, explicit `where tenantId` | 1.16 ms | 11.1 ms | ~1,715 |
| RLS, one batch transaction per operation | 3.5 ms | 35.9 ms | ~500 |
| RLS, one interactive transaction per request | 1.63 ms | 19.6 ms | ~1,130 |

All 15 correctness checks passed, including 3,000 concurrent operations across 50 tenants on a shared pool with no cross-tenant row and no setting leaking onto a pooled connection. Policies keep using the `(tenant_id, …)` indexes.

**Decision:**
1. RLS stays on for **all** reads and writes. The Phase 0 fallback (RLS for writes only) is not needed.
2. **Default:** the tenant-scoped client wraps each operation in a batch transaction (`BEGIN; set_config; query; COMMIT`). It is automatic and never holds a connection across application code.
3. **`withTenantTx(fn)`:** an explicit interactive transaction for multi-statement units of work (atomic writes such as quotation → order, and query-heavy reads). It sets `app.tenant_id` once and publishes the transaction client in the CLS context. Nested calls join the outer transaction. External I/O (HTTP, email, queues) must not happen inside it.
4. Services never hold a Prisma client. They call `db()`, which returns the ambient transaction client if one is open and the scoped client otherwise. Interactive transaction clients can't be extended in Prisma 7, so this is the only way to avoid "outer client inside a transaction" bugs.
5. Policies use `nullif(current_setting('app.tenant_id', true), '')::uuid`. Once a pooled connection has seen the setting, its unset value is `''`, not NULL, and `''::uuid` raises an error instead of matching no rows.
6. Prisma queries are lazy: they run on `await`, not on call. Context helpers must `await` inside the context. A query started inside the context but awaited outside it fails with `MissingTenantContextError` (fail closed).

**Consequences:**
- Overhead is about 2.3 ms per five-operation request locally. On the VPS the Docker network adds about 0.1 ms per extra round trip (15 per request). That is acceptable at the planned scale (hundreds of tenants, low request rates), and the system has 3× headroom over baseline on a laptop.
- Re-benchmark with k6 on the VPS in Phase 8. PgBouncer in transaction mode stays compatible, because the setting is transaction-local.
- Not measured: the TCP path, and the non-owner `tahi_app` role. The spike ran as the table owner with `FORCE ROW LEVEL SECURITY`, which applies the same policies. The Phase 2 integration suite covers `tahi_app` in CI.

## ADR-019 — Tenancy core: no Redis caching yet; access guard and schema refinements
**Status:** Accepted (2026-11-11, approved by the product owner)
**Context:** Phase 2 implements tenant resolution, sessions and access control. The Phase 0 docs planned Redis caches: sessions for 60 s, Host → tenant for 5 min.
**Decision:**
1. **No Redis caching for sessions or TenantDomain for now.** Each request does one lookup by unique index in PostgreSQL (well under 1 ms). A cache would add a revocation window: a revoked session could stay valid until the cache entry expires or the delete reaches Redis. Revisit with k6 numbers in Phase 8.
2. **One global `AccessGuard`** does deny-by-default, realm ↔ Host matching, storefront tenant resolution, session validation and permission checks. A boot-time `RouteAccessAudit` refuses to start the API if any route lacks `@Realm()` plus `@Public()`, `@Authenticated()` or `@RequirePermission()`.
   - `@Authenticated()` (new) is for routes that need a session but no tenant permission, e.g. "who am I" and onboarding.
   - `@AllowMfaPending()` (new) is for the platform MFA endpoints.
3. **A realm mismatch returns 404**, e.g. a tenant route on the admin host. The route does not exist on that host.
4. **Tenant lifecycle (interim):** staff get a tenant context only when the membership is `ACTIVE` and the tenant is `TRIAL`, `ACTIVE` or `PAST_DUE`. Otherwise permission routes return `403 NO_ACTIVE_TENANT`. The read-only `SUSPENDED` mode and billing-only access arrive with tenant lifecycle work (Phase 6/7). Storefronts resolve only verified domains of online tenants.
5. **Schema refinements to `DATABASE_DESIGN.md`:**
   - `Session` adds:
     - `tenantId` for staff, the active membership's tenant. It is checked against the membership through RLS, so a mismatched pair yields no tenant context.
     - `absoluteExpiresAt`.
     - `mfaVerifiedAt`.
   - `RolePermission` carries `tenant_id` (RLS, and a composite FK to `role`).
   - Read-only RLS policies `user_own_memberships` and `user_membership_roles` let a user list their own memberships before choosing a tenant (`withUserScope`).
   - `audit_log` and `tenant_audit_log` are append-only via triggers. These block UPDATE, DELETE and TRUNCATE for every role.
6. **Static checks run as unit tests:**
   - `UNSCOPED_PRISMA` is used only in allow-listed directories;
   - `@tahi/validation` contains no `tenantId`;
   - the RLS table set must equal `TENANT_MODELS`.
**Consequences:** Fewer moving parts, and revocation takes effect immediately. CSRF (Origin check plus double-submit token) lands with the staff-auth branch, which introduces the first cookie-setting, state-changing routes.
