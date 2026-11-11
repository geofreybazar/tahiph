# Development Roadmap — TAHI.ph

> **Status:** Phases 0–2 complete (approved 2026-11-11). Phase 3 in progress: scope and step order approved 2026-11-11 (see Phase 3 progress). Later phases are planned, not started.
> Each phase ends with: tests green, docs updated, an implementation report, and product-owner approval to merge.

| Phase | Name | Status |
|---|---|---|
| 0 | Product discovery & architecture | **Complete** |
| 1 | Project foundation | **Complete** (local Docker check outstanding, see below) |
| 2 | Authentication & multi-tenancy | **Complete** |
| 3 | Tenant business management | **In progress** |
| 4 | Sales & operations | Not started |
| 5 | Personalized storefront | Not started |
| 6 | Financial & subscription management | Not started |
| 7 | Platform administration | Not started |
| 8 | Production readiness | Not started |

## Phase 0 — Discovery & architecture
**Deliverables:** the documents in `docs/`.
**Exit criteria:** architecture approved, and open questions Q1–Q10 answered or accepted with defaults.

## Phase 1 — Project foundation
Work items:
- Turborepo + npm workspaces; shared `packages/config` (tsconfig, ESLint flat config, Prettier).
- Pin versions after a compatibility check: Node LTS, Next.js, NestJS, Prisma, Zod, PostgreSQL major.
- Scaffold `apps/dashboard`, `apps/storefront`, `apps/admin` (Next.js App Router, Tailwind, shadcn/ui), and `apps/api` with the HTTP and worker entrypoints.
- `packages/database` (Prisma, empty initial migration, roles/extensions init SQL), `packages/validation`, `packages/types`, `packages/utils`.
- API core: config validation, CLS context, Pino logging, exception filter, response envelope, health endpoints.
- Docker:
  - local Compose (postgres, redis, mailpit). Local S3 storage is deferred to Phase 3 (see ADR-016);
  - Dockerfiles for all apps;
  - a prod Compose skeleton with Traefik.
- Vitest across workspaces; Supertest harness with an ephemeral DB.
- GitHub Actions CI (lint, typecheck, test, build). No deploy yet.

**Exit criteria:**
- [x] `npm ci && turbo lint typecheck test build` passes (verified locally, 2026-11-11).
- [ ] `docker compose up` brings up all services healthy locally. **Not verified:** Docker is not installed in the development WSL environment.
- [x] CI is green, including the Docker image build and smoke jobs, which stand in for the local Docker check (run 42968791459, 2026-11-11).

Approved by the product owner on 2026-11-11 with the local Docker check still open (tracked as R16). CI's image build and smoke jobs cover it in the meantime.

**Implementation notes:** see ADR-014 to ADR-017 for version pins and deviations (ESM backend, TypeScript 6, ESLint 9, OpenAPI deferred to Phase 2, local S3 deferred to Phase 3).

## Phase 2 — Authentication & multi-tenancy
Work items:
- Prisma schema slice: User, PlatformUser, Session, AuthToken, Tenant, TenantDomain, TenantMembership, Role, RolePermission, AuditLog, TenantAuditLog.
- **Spike:** Prisma tenant extension + RLS benchmark (ADR outcome).
- Tenant resolution middleware, realm guard, session guard, permission guard, deny-by-default.
- Staff register/verify/login/logout/reset; invitations; tenant onboarding; atelier switcher.
- Platform admin login with TOTP; Super Admin seed CLI.
- Customer OTP login (storefront realm).
- **Cross-tenant test suite** + RLS checks in CI.

**Progress:**
- [x] RLS spike (ADR-018).
- [x] Tenancy core: schema slice, RLS, scoped client, access guard, sessions, permission catalogue (ADR-019). Merged.
- [x] Staff auth on `feat/staff-auth`: register/verify/login/logout/reset, onboarding, invitations, switcher, CSRF, throttling, email queue (ADR-020). Merged.
- [x] Platform auth on `feat/platform-auth`: password + mandatory TOTP, recovery codes, encrypted secrets, Super Admin CLI (ADR-021). Merged.
- [x] Customer auth on `feat/customer-auth`: email code + magic link, per-atelier accounts (ADR-022). Merged.

**Exit criteria:**
- [x] **Cross-tenant suite passes for every route, with one caveat:**
  - Every route is checked at boot for an explicit realm and access rule (deny by default).
  - The only tenant-realm route that takes resource ids from the client, `POST /tenant/invitations` (`roleId`), has a cross-tenant 404 test.
  - The access suite covers foreign ids, foreign hosts and foreign sessions.
  - Automatic per-route cross-tenant tests enumerated from the router were added afterwards on `feat/api-contracts` (merged 2026-11-11).
- [x] RLS check passes for every tenant table. The integration test compares database policies with `TENANT_MODELS` and runs as a non-superuser role.
- [x] Auth flows are covered by integration tests: staff, platform and customer.
- [x] Throttling is verified with the in-memory store in flow tests and the Redis store in CI.

**Open from Phase 2:** the OpenAPI generator choice (ADR-015) has not been made. Phase 2's endpoints are fully described by the Zod contracts in `@tahi/validation`. Propose deciding it at the start of Phase 3.

## Phase 3 — Tenant business management
**Progress:**
- [x] `feat/api-contracts`: OpenAPI generator + automatic cross-tenant suite. Merged 2026-11-11.
- [x] `fix/cross-tenant-suite`: the suite covers PUT/PATCH/DELETE and detects foreign updates. Merged 2026-11-11.
- [x] `feat/tenant-settings-staff`: business profile, settings, opening hours, holidays, staff management, invitation list/revoke (ADR-024). Merged 2026-11-11.
- [x] `feat/custom-roles`: custom role editing with no privilege escalation (ADR-025). Merged 2026-11-11.
- [ ] `feat/clients` (in review): clients, notes and communication log (ADR-026).
- [ ] Garment categories, measurement templates and immutable records.
- [ ] Appointments (types, availability, booking with the exclusion constraint, reminders).
- [ ] Catalogue.
- [ ] Uploads pipeline (needs a storage dependency decision and an ADR).
- [ ] Proposed, not yet approved: client data export and erasure (RA 10173, `SECURITY.md` §4), before launch.

Business profile and settings (hours, holidays, timezone, tax); staff management; clients (CRM); garment categories; measurement templates and immutable records; appointment types, availability, booking with the exclusion constraint and reminders; catalogue (products, services, options); uploads pipeline.

**Exit criteria:** the double-booking concurrency test passes (parallel inserts → exactly one succeeds); measurement revisions are immutable; uploads are validated.

## Phase 4 — Sales & operations
Quotations (revisions, send link, accept/reject, expiry job); quotation → order conversion (transactional, idempotent); orders with snapshots and timeline; production workflows/stages/jobs/assignments; fittings and alterations; **manual payment recording** with acknowledgment receipts; balances; refunds (manual); email notifications; business dashboard KPIs.

**Exit criteria:** an end-to-end Playwright journey (inquiry → quotation → order → production → payment → release) passes.

## Phase 5 — Personalized storefront
Host-based tenant resolution; theming; sections; portfolio, collections, testimonials; services; inquiry and quotation request forms (Turnstile); public appointment booking; customer order tracking; SEO (metadata, sitemap, OG, JSON-LD); ISR + revalidation; custom-domain foundation (TenantDomain verification, Cloudflare for SaaS integration behind a feature flag).

**Exit criteria:** Lighthouse ≥ 90 performance and accessibility on the template; cross-host isolation tests pass.

## Phase 6 — Financial & subscription management
**Prerequisite:** PayMongo answers P1–P9 (see `PAYMENT_ARCHITECTURE.md` §7).

Plans and features; subscriptions; billing engine jobs; SaaS invoices and checkout; PayMongo provider adapter; webhook ingress (idempotent); tenant merchant onboarding (child accounts or the OWN_KEYS fallback); online customer payments (100% to the tenant); refunds via provider; reconciliation jobs; financial reports per ledger.

**Exit criteria:**
- Webhook replay and duplicate tests pass.
- Signature-forgery test passes.
- Reconciliation detects injected mismatches.
- Ledgers are verified as separated.

## Phase 7 — Platform administration
Super Admin dashboard (tenants, MRR/ARR, trials); tenant management (approve, suspend, audited data access); plan and subscription admin; revenue, failed payments, refunds; platform settings, feature flags, announcements; support tickets; audit log viewer.

## Phase 8 — Production readiness
Security testing (ZAP, ASVS review, optional pentest); performance testing (k6) and query tuning; monitoring and alerting; backup automation and restore drill; full CD with staging and production environments; VPS hardening verification; documentation review; launch checklist.

## Dependency graph

```
0 → 1 → 2 → 3 → 4 → 5
              └──────► 6 (needs 4 for customer payments; billing part only needs 2)
                        7 (needs 2 + 6 for revenue views)
                        8 (continuous, finalized last)
```
