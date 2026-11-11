# CLAUDE.md — TAHI.ph

Multi-tenant SaaS for fashion designers and bespoke ateliers (Philippines). Monorepo: Turborepo + npm workspaces.

**Current phase:** 0 (architecture) is in review. **No application code exists yet. Do not scaffold, install dependencies or implement features until the product owner approves the phase.**

## Source of truth
Read `docs/` before working on any area. Key docs:
- `docs/SYSTEM_ARCHITECTURE.md`: apps, packages, routing
- `docs/MULTI_TENANCY.md`: **mandatory** isolation rules
- `docs/AUTHENTICATION_AND_AUTHORIZATION.md`: realms, sessions, permissions
- `docs/DATABASE_DESIGN.md`, `docs/DATABASE_ERD.md`
- `docs/PAYMENT_ARCHITECTURE.md`: three separate ledgers
- `docs/API_STANDARDS.md`: module layout, response envelope, errors
- `docs/ARCHITECTURAL_DECISIONS.md`: ADRs. Add a new ADR for any significant change.

## Layout (planned)
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
6. Never mix ledgers: SaaS billing (TAHI) vs tenant customer payments vs platform fees.
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
None yet (Phase 1 will add `npm run dev|lint|typecheck|test|build` via Turborepo).

## Environment notes
- Node 24 / npm 11 available locally. The Docker CLI is **not** installed in the WSL environment yet (required for Phase 1).
