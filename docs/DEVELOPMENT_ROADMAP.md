# Development Roadmap — TAHI.ph

> **Status:** Phases 0–2 complete (approved 2026-11-11). Phase 3 complete (approved 2026-11-13). Phase 4 scope and step order approved 2026-11-13, not started. Later phases are planned, not started.
> Each phase ends with: tests green, docs updated, an implementation report, and product-owner approval to merge.

| Phase | Name | Status |
|---|---|---|
| 0 | Product discovery & architecture | **Complete** |
| 1 | Project foundation | **Complete** |
| 2 | Authentication & multi-tenancy | **Complete** |
| 3 | Tenant business management | **Complete** |
| 4 | Sales & operations | Not started (scope approved) |
| 4b | Dashboard UI | Not started |
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
  - local Compose (postgres, redis, mailpit). Local S3 storage is deferred to Phase 3 (see ADR-016; added in Phase 3 step 8, ADR-031);
  - Dockerfiles for all apps;
  - a prod Compose skeleton with Traefik.
- Vitest across workspaces; Supertest harness with an ephemeral DB.
- GitHub Actions CI (lint, typecheck, test, build). No deploy yet.

**Exit criteria:**
- [x] `npm ci && turbo lint typecheck test build` passes (verified locally, 2026-11-11).
- [x] `docker compose up` brings up all services healthy locally. Verified 2026-11-13 after Docker Desktop WSL integration was enabled (postgres, redis, mailpit; rustfs since ADR-031). The production stack has not been run locally.
- [x] CI is green, including the Docker image build and smoke jobs, which stand in for the local Docker check (run 42968791459, 2026-11-11).

Approved by the product owner on 2026-11-11 with the local Docker check still open (R16); that check passed on 2026-11-13.

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
- [x] `feat/clients`: clients, notes and communication log (ADR-026). Merged 2026-11-11.
- [x] `feat/measurements`: garment categories, versioned templates, immutable records (ADR-027). Merged 2026-11-11. Meets the exit criterion "measurement revisions are immutable".
- [x] `feat/appointments` (step 6a, merged 2026-11-11): types, staff availability and time off, slots, booking with the exclusion constraint, reschedule and status changes (ADR-028). Meets the exit criterion "double-booking concurrency test passes".
- [x] `feat/appointment-reminders` (step 6b, merged 2026-11-11): 24-hour email reminders from the worker, first tenant-scoped background job (ADR-029).
- [x] `feat/catalog` (step 7, merged 2026-11-11): categories, products and services, shared option groups (ADR-030).
- [x] `feat/uploads` (step 8, merged 2026-11-13): presigned image uploads to R2 (RustFS locally), worker verification and WebP re-encoding, catalogue item images and the atelier logo (ADR-031). Meets the exit criterion "uploads are validated".
- [x] `feat/client-privacy` (merged 2026-11-13): client data export and erasure (RA 10173, ADR-032), before launch. Legal review still required.

Business profile and settings (hours, holidays, timezone, tax); staff management; clients (CRM); garment categories; measurement templates and immutable records; appointment types, availability, booking with the exclusion constraint and reminders; catalogue (products, services, options); uploads pipeline.

**Exit criteria:** the double-booking concurrency test passes (parallel inserts → exactly one succeeds); measurement revisions are immutable; uploads are validated. All three met; CI green on `main` (run 43384877509, 2026-11-13). Phase 3 approved by the product owner on 2026-11-13.

**Carried forward (not Phase 3 scope):** a real-R2 upload test (`DEPLOYMENT.md` §7); client data export and erasure is built (above) but needs legal review; upload follow-ups listed in ADR-031.

## Phase 4 — Sales & operations
API only (the dashboard screens are Phase 4b). Scope and step order approved by the product owner on 2026-11-13.

**Steps** (one branch each, in order):
- [ ] `feat/quotations`: `TenantCounter` numbers (`QUO-2026-0007`); quotations with items snapshotting catalogue name, price and options plus a measurement-record reference; server-computed discount and tax; revisions (approved quotations are read-only); DRAFT → SENT → ACCEPTED/REJECTED/EXPIRED; expiry job; optimistic locking.
- [ ] `feat/orders`: quotation → order conversion (one transaction, row lock, `UNIQUE(quotation_id)` makes it idempotent); direct orders for walk-in sales; items with price and measurement snapshots; statuses, promised date, timeline.
- [ ] `feat/production`: per-atelier configurable stages (default set seeded); one job per order item; assignments (`production.read_assigned`); stage history.
- [ ] `feat/fittings-alterations`: fittings (optionally linked to an appointment), alteration loops, QC, release.
- [ ] `feat/payments`: manual payments (cash, GCash, Maya, bank transfer) with reference and optional proof image (uploads pipeline, private purpose); acknowledgment receipt numbers (`RCPT-…`); computed balance; manual refunds under row lock (≤ the payment, `payments.refund`).
- [ ] `feat/notifications-kpis`: emails via `MAILER` (quotation sent, order confirmed, ready for pickup, payment received); dashboard KPI endpoint; the end-to-end journey test.

**Decisions (2026-11-13):**
- Customers' accept/reject is recorded by staff in Phase 4; the emailed accept link needs a storefront page and moves to Phase 5.
- Totals honour the existing settings `pricesIncludeTax` (default on: Philippine prices are usually quoted VAT-inclusive) and `taxRate` (0% for non-VAT ateliers) from ADR-024.
- One production job per order item.
- Payment kind is recorded (down payment, partial, installment, final); installment schedules are later.
- Receipts are acknowledgment receipts as structured data plus an emailed HTML version, labelled "Acknowledgment Receipt — not an official receipt or BIR sales invoice". PDF later (needs a dependency). The label needs legal review (R3).
- Data-subject erasure (ADR-032) carries over: orders and payments keep referencing the anonymized client, receipts keep their snapshots (BIR retention), erasure clears measurement snapshots on order items and is refused while the client has open orders.

**Exit criteria:** an end-to-end journey (inquiry → quotation → order → production → payment → release) passes as an HTTP-level integration test against the API. (The browser journey with Playwright is Phase 4b's exit criterion.)

## Phase 4b — Dashboard UI
The atelier dashboard's screens (`apps/dashboard`) over the Phase 2–4 API: sign-in and onboarding, atelier switcher, settings and staff, clients and measurements, appointments, catalogue and uploads, quotations, orders, production, payments. Added on 2026-11-13: until then only the API had been built, and no phase planned the screens. Scope, steps and UI dependencies (Playwright among them) to be proposed before it starts.

**Exit criteria:** an end-to-end Playwright journey (inquiry → quotation → order → production → payment → release) passes in the browser.

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
