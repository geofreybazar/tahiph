# Technical Risk Assessment — TAHI.ph

> **Status:** Proposed (Phase 0). Reviewed at the end of each phase.
> Likelihood and impact: L / M / H.

| # | Risk | L | I | Mitigation | Phase |
|---|---|:-:|:-:|---|---|
| R1 | **Prisma + RLS overhead and complexity.** Each scoped operation is wrapped in a transaction to `SET LOCAL app.tenant_id`; interactive transactions need context propagation; risk of developers bypassing via the unscoped client. | L | H | **Spike done (ADR-018):** ~2.3 ms overhead per five-query request locally, no leakage in 3,000 concurrent ops. `withTenantTx` + `db()` accessor; lint rule restricting `UNSCOPED_PRISMA`; CI RLS-coverage check; re-benchmark on the VPS in Phase 8 | 2, 8 |
| R2 | **PayMongo Platforms availability, pricing or child KYC** may not suit small, informal ateliers. | M | H | Manual payments from Phase 4; OWN_KEYS fallback; resolve P1–P9 with PayMongo before Phase 6 | 0→6 |
| R3 | **Philippine compliance:** Data Privacy Act (measurements and photos are personal data); BIR invoicing rules (RR 7-2024) for receipts. | M | H | Label receipts "Acknowledgment Receipt"; DPA in ToS; privacy notice and consent; erasure workflow; **legal counsel before launch** | 4, 8 |
| R4 | **Single VPS = single point of failure** (hardware, provider outage, disk). | M | H | Off-site encrypted backups + PITR; automated restore tests; documented RTO 4 h; stateless apps; infra as scripts | 1, 8 |
| R5 | **Custom-domain TLS at scale** (ACME rate limits, validation). | L | M | Cloudflare for SaaS (ADR-008) | 5 |
| R6 | **Cross-tenant cache leakage** in the storefront (ISR or CDN serving tenant A's page for B). | M | H | Cache keys always include the hostname; revalidation tags per tenant; `Vary: Host`; tests across two hosts; no shared in-memory caches keyed only by path | 5 |
| R7 | **Appointment race conditions** (double booking). | M | M | Postgres exclusion constraint as the source of truth; concurrency test | 3 |
| R8 | **Webhook duplication, reordering or forgery.** | M | H | Signature verification on the raw body; unique event store; monotonic transitions; amount cross-check; reconciliation | 6 |
| R9 | **Image-heavy storefronts** hurt performance and storage cost. | H | M | Worker-side resizing and EXIF stripping; `next/image`; R2 + Cloudflare cache; per-plan storage quotas | 3, 5 |
| R10 | **Scope creep** across 11 modules + 3 interfaces. | H | M | MVP tags in the PRD; phase gates; small PRs | all |
| R11 | **Dependency churn** (Next.js, Prisma major changes, e.g. Prisma 7 config/driver-adapter changes). | M | M | Pin versions in Phase 1 after compatibility checks; Renovate with grouped updates; no bleeding-edge majors without an ADR | 1 |
| R12 | **Docker bypassing ufw** exposes services if someone publishes a port. | M | H | Only Traefik publishes; `DOCKER-USER` rules; CI lint of the Compose file (no `ports:` except traefik); external port scan in the checklist | 1, 8 |
| R13 | **Platform admin abuse or insider access** to tenant data. | L | H | Separate realm; MFA; `platform.tenants.access_data` permission with reason; audit log; tenant notification on impersonation | 2, 7 |
| R14 | **Measurement-template evolution** breaking historical records. | M | M | Versioned templates; records reference the template version; order snapshots store labels + values | 3 |
| R15 | **Report queries** on a shared DB slowing the OLTP workload. | M | M | Tenant-leading indexes; pre-aggregation jobs; read replica later | 6–8 |
| R16 | **Local environment:** Docker not installed in WSL. Phase 1 Docker files are verified only in CI. | H | M | Enable Docker Desktop WSL integration or install Docker Engine; run `docker compose up -d` and the prod stack locally | 1 |
| R17 | **ESLint 9 is end-of-support**, but Next's lint plugins don't support ESLint 10 yet. | H | L | Lint-time only (no runtime exposure). Upgrade once `eslint-config-next` supports 10 (Renovate). | 1→ |
| R18 | **`npm audit`: 7 moderate findings**, all one `minimatch` ReDoS reached via `typescript-eslint` (lint tooling; never in runtime images). | M | L | The CI gate fails on high/critical only. Update when typescript-eslint ships a fixed transitive version. | 1→ |
| R19 | **Undocumented Prisma internal** (`__internalParams.transaction.kind`) is used to detect a client captured outside `withTenantTx`. | L | M | Fails closed: if a Prisma upgrade removes it, every in-transaction query throws and the integration suite fails. Versions are pinned (ADR-014). | 2→ |

## Potential bottlenecks (to monitor)

1. Postgres connections: API + worker pools. Introduce PgBouncer (transaction mode) once there are more than ~2 API replicas.
2. Session lookups: Redis cache, then the DB.
3. The storefront's server-side API calls on cache miss. ISR keeps most traffic static.
4. BullMQ email bursts (reminder batches): rate-limited queue.
