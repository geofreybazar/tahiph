# CLAUDE.md — TAHI.ph

Multi-tenant SaaS for fashion designers and bespoke ateliers (Philippines). Monorepo: Turborepo + npm workspaces.

**Current phase:** Phases 0–2 are complete and merged. Q1 (per staff member) and Q2 (per-tenant unit, numeric(7,3)) are answered. **Do not start Phase 3 until the product owner approves its scope.**

## Source of truth
Read `docs/` before working on any area. Key docs:
- `docs/SYSTEM_ARCHITECTURE.md`: apps, packages, routing
- `docs/MULTI_TENANCY.md`: **mandatory** isolation rules
- `docs/AUTHENTICATION_AND_AUTHORIZATION.md`: realms, sessions, permissions
- `docs/DATABASE_DESIGN.md`, `docs/DATABASE_ERD.md`
- `docs/PAYMENT_ARCHITECTURE.md`: two separate ledgers
- `docs/API_STANDARDS.md`: module layout, response envelope, errors
- `docs/ARCHITECTURAL_DECISIONS.md`: ADRs. Add a new ADR for any significant change.

## Layout
- `apps/dashboard` (app.tahi.ph), `apps/storefront` (*.tahi.ph + custom domains), `apps/admin` (admin.tahi.ph): Next.js App Router
- `apps/api`: NestJS modular monolith with two entrypoints, `main.ts` (HTTP) and `main.worker.ts` (BullMQ worker, separate container)
- `packages/database` (Prisma), `validation` (Zod contracts), `types`, `ui`, `config`, `utils`
- `infrastructure/` (docker, traefik, postgres, scripts)

## Non-negotiable rules
1. Tenant context comes **only** from the server: the session's active membership or the Host → `TenantDomain` lookup. Never accept `tenantId` from client input, and never add `tenantId` to tenant-realm DTOs.
2. Use the tenant-scoped Prisma client. `UNSCOPED_PRISMA` is allowed only in auth, tenants and platform modules.
3. Every tenant table needs `tenant_id`, `UNIQUE(tenant_id,id)`, composite FKs, tenant-leading indexes and an enabled + forced RLS policy.
4. Foreign-tenant ids return **404**. Add cross-tenant tests for every new route.
5. Money is `numeric(12,2)` + currency, sent as strings. No floats. Timestamps are `timestamptz` UTC.
6. Never mix ledgers: SaaS subscriptions (TAHI's only revenue) vs tenant customer payments (100% the tenant's). TAHI takes no cut of tenant sales.
7. Measurements are immutable revisions; order items keep snapshots.
8. Routes are deny-by-default: each needs `@Realm()` plus either `@RequirePermission()` or `@Public()`.
9. No secrets in git. Only `.env.example` with placeholders.
10. Only Traefik publishes ports. Postgres and Redis are never exposed.
11. No destructive migrations without approval. Migrations follow expand → migrate → contract.
12. Evaluate every new dependency for necessity and compatibility first, and pin versions.

## Workflow
- Work on a branch (`feat/`, `fix/`, `docs/`, `chore/`). **Ask the product owner before merging to `main` and deleting the branch.**
- Process per feature: requirement analysis → impact analysis → proposal → implement approved scope → verify (typecheck, lint, tests, build) → update docs → implementation report.
- Never claim completion without running verification. Docs must distinguish planned work from implemented work.
- Conventional Commits.

## Commands
- `npm run lint | typecheck | test | build`: everything via Turborepo. Run all four before claiming completion.
- `npm run test:int`: API integration tests (needs `DATABASE_URL` + `REDIS_URL`).
- `npm run db:migrate:dev | db:migrate:deploy | db:generate`: Prisma (`packages/database`).

## Tenancy conventions (ADR-018, ADR-019)
- Services inject `TENANT_DB` and call `db()` (never hold a client). Use `withTenantTx(fn)` for multi-statement units of work; no external I/O inside it.
- New tenant model: add it to `packages/database/src/tenancy/tenant-models.ts`, add the RLS SQL (`app_tenant_id()` policy, ENABLE + FORCE) to its migration, and use unchecked inputs (`tenantId` scalar). The RLS integration test fails otherwise.
- Routes: `@Realm()` plus `@Public()`, `@Authenticated()` or `@RequirePermission()`, plus `@ResponseSchema()`. The API won't start otherwise. Return plain data; the interceptor parses it with the response schema.
- Ids of tenant resources in a request (path params, uuid body fields) must be declared with `@References({ field: 'kind' })`, and the route needs a sample in `test/cross-tenant.int.spec.ts` (plus a fixture for a new resource kind).
- Integration tests run as a non-superuser, non-BYPASSRLS role. Use `apps/api/test/fixtures.ts` (unique data, no cleanup) and `test/browser.ts` (cookies + CSRF) for HTTP flows.
- Every non-GET browser request needs `Origin` + `X-CSRF-Token` (from `GET /api/v1/auth/csrf`). Emails go through `MAILER` (BullMQ queue), never sent inline.

## Conventions
- **ESM everywhere** (NestJS 12 is ESM-only). Use relative imports with a `.js` suffix in TS sources.
- **Versions are pinned exactly.** See ADR-014 before upgrading (TypeScript is held at 6.0.x and ESLint at 9.x for plugin compatibility).
- **Zod is the only validation library.** Use `ZodValidationPipe` with schemas from `@tahi/validation`. Env is validated in `apps/api/src/core/config/env.ts`.
- **Errors:** throw `DomainError` subclasses (`apps/api/src/core/http/domain-error.ts`). The global filter builds the envelope.
- **Package tsconfigs:** `tsconfig.json` is for typecheck and lint (includes specs); `tsconfig.build.json` emits `dist`.
- **npm install scripts** must be reviewed and approved via `npm install-scripts approve <pkg>` (root `allowScripts`).

## Environment notes
- Node 24 / npm 11 available locally. The Docker CLI is **not** installed in WSL yet, so Docker artifacts are verified in CI only.
