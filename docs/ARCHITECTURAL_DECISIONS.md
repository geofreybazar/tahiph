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

## ADR-020 — Staff authentication implementation choices
**Status:** Accepted (2026-11-11, approved by the product owner)
**Decision:**
1. **Argon2id from `node:crypto`** (Node 24's built-in `argon2`): no native npm dependency and no install script. It uses OWASP parameters (19 MiB, t=2, p=1), stores hashes in PHC format and rehashes on login when the parameters were weaker. About 27 ms per hash locally.
2. **No SMTP library.** The worker sends email over HTTP with `fetch`: Resend's API in production, Mailpit's send API locally, and a log transport in tests and CI. The API only enqueues to BullMQ, so emails never wait on the provider. Jobs can contain one-time links, so completed jobs are removed immediately and failed jobs after 24 h.
3. **Throttling** (limits from §5) uses fixed-window counters in Redis plus a per-account exponential backoff from the 5th failure (1, 2, 4… min, capped at 60). **It fails open when Redis is unavailable** (logged), so a Redis outage does not lock everyone out. Readiness reports Redis down, and Cloudflare rate limiting stays in front.
4. **CSRF** applies to every non-GET request on browser hosts, public or not, so login CSRF is covered too:
   - the `Origin` header must name the request host, with https required in production;
   - the double-submit header must match a non-HttpOnly `__Host-tahi_csrf` cookie, issued by `GET /api/v1/auth/csrf`.
5. **Invitations** are `AuthToken(INVITE)` rows with `metadata.roleId` (migration 0003, additive). The membership is created only on acceptance:
   - An existing account must be signed in as the invited email.
   - A new account is created from name + password; the email counts as verified by the link.
   - The owner role cannot be invited.
6. **Login** selects the active atelier automatically only when exactly one usable membership exists; otherwise the UI shows a picker (`POST /auth/switch-tenant`). Login, tenant switch, onboarding and invitation acceptance all rotate the session.
7. **Onboarding status** is set by `TENANT_ONBOARDING_STATUS` (default `TRIAL`), pending business question Q6. `PENDING_APPROVAL` is supported, but no approval tooling exists until Phase 7.
8. **Deferred:**
   - optional staff TOTP (per-tenant enforcement);
   - the breached-password (HIBP) check;
   - listing and revoking one's own sessions;
   - staff management beyond invitations (list, disable, change role), which is Phase 3.

## ADR-021 — Platform admin authentication
**Status:** Accepted (2026-11-11, approved by the product owner)
**Decision:**
1. **TOTP is implemented in-house** (RFC 6238 on `node:crypto`: HMAC-SHA1, 30 s, 6 digits, ±1 step), checked against the RFC test vectors, so no dependency is needed.
   - Each accepted time step is stored (`platform_user.mfa_last_step`), so a code can never be used twice.
   - Attempts are limited to 5 per session per 15 minutes.
2. **Two-step login:**
   - The password yields a **5-minute pre-MFA session** that only `@AllowMfaPending()` endpoints accept.
   - A valid TOTP or recovery code revokes it and issues a full session (30 min idle, 12 h absolute) with `mfaVerifiedAt` set.
   - First login enrolls the authenticator. Once enrolled, enrollment cannot be restarted from a password-only session.
3. **TOTP secrets are encrypted** with AES-256-GCM (`SecretBox`).
   - The key ring comes from `ENCRYPTION_KEYS` ("id:base64key", first = active). The key id is stored with each ciphertext, so keys can rotate.
   - The admin row id is bound as associated data.
   - The same box will hold tenant provider credentials (Phase 6).
4. **Recovery codes:** 10 single-use codes (~49 bits each), shown once at enrollment and stored as SHA-256 hashes (`platform_recovery_code`, migration 0004).
5. **First Super Admin:** created with `node dist/cli/main.create-super-admin.js --email … --name …`.
   - The password comes from stdin or `SUPER_ADMIN_PASSWORD`, never from argv.
   - The insert runs in a serializable transaction that refuses if any Super Admin exists.
   - There is no self-registration. Further admins are created in the admin dashboard (Phase 7).
**Deferred to Phase 7:** step-up re-authentication for sensitive actions, resetting MFA for an admin who lost their device (Super Admin action), admin management, and WebAuthn.

## ADR-022 — Storefront customer sign-in
**Status:** Accepted (2026-11-11, approved by the product owner)
**Decision:**
1. **`CustomerAccount` is a tenant-owned table** (RLS, `UNIQUE(tenant_id, email)`, migration 0005). The same email at two ateliers is two unrelated accounts: separate data subjects and controllers under the Data Privacy Act.
   - The link to the CRM `Client` (doc §3.5, "links or creates a Client") is **deferred to Phase 3**, when `Client` is designed. It will be an additive `client_id` with a composite FK.
2. **Passwordless:** `POST /customer/auth/start` emails a 6-digit code and a magic link, both from one `AuthToken(CUSTOMER_OTP)` row, valid for 10 minutes.
   - The link token is stored as SHA-256. The code is stored as a salted SHA-256 in the token's metadata.
   - Five wrong codes burn the token. A new request replaces older codes.
   - Sends are limited per IP and per email per atelier.
   - `start` always answers 202 and sends nothing to disabled accounts.
3. **Account creation:** the first verification creates the account. The email counts as verified because the code was received there.
4. **Tenant binding:** codes and links work only on the host of the atelier that issued them. Customer sessions are accepted only on that atelier's hosts, and only for an `ACTIVE` account, which the access guard reads through RLS.
5. **Links** use `STOREFRONT_URL_TEMPLATE` (default `https://{host}`; local dev `http://{host}:3002`).
**Consequences:** A database leak would expose code hashes that can be brute-forced (10⁶ possibilities). That is acceptable for 10-minute, single-use codes.

## ADR-023 — OpenAPI generated from the Zod contracts
**Status:** Accepted (2026-11-11, product owner chose the recommended option)
**Context:** ADR-015 deferred the OpenAPI generator. `nestjs-zod` does not support NestJS 12, and `@nestjs/swagger` would describe every endpoint a second time with decorators.
**Decision:** Build the OpenAPI 3.1 document from the existing `@tahi/validation` schemas with Zod 4's `z.toJSONSchema()`. There is no new dependency, and the Zod contracts stay the single source of truth.
- **No separate registry.** A route inventory (`core/http/route-inventory.ts`) reads the metadata that already drives the app:
  - request schemas from each `ZodValidationPipe`;
  - the response schema from `@ResponseSchema()`;
  - realm, access and permissions from the auth decorators;
  - status from `@HttpCode`;
  - ids from `@References()`.
- `@ResponseSchema()` is mandatory: the boot audit refuses to start without it, and the envelope interceptor parses every response with it, so undeclared fields are stripped.
- A unit test checks that the inventory's paths equal Express's registered routes, and that the document contains no tenant id or secret fields.
- **Delivery** (implemented, merged 2026-11-11): `npm run openapi -w @tahi/api -- <file>` writes the document, and CI uploads it as the `openapi` artifact. The API does not serve it in any environment.
- Refinements and transforms (e.g. email normalization) appear as plain types in the document; they are enforced at runtime.
**Consequences:** About 250 lines of glue code that we maintain.

## ADR-024 — Atelier settings, staff management and the member access mode
**Status:** Accepted (2026-11-11, product owner approved the Phase 3 step 2 scope)
**Context:** Phase 3 step 2 adds the business profile, settings, opening hours, holidays and staff management. Every member needs some of this data (timezone, hours), but `@Authenticated()` does not require an active atelier, and `@RequirePermission()` deliberately rejects an empty permission list.
**Decision:**
- **Access mode `member`** (`@ActiveMember()`): tenant realm only; requires an active membership of an operational atelier and no specific permission. The route audit rejects it on other realms. Reads use it; writes need `tenant.settings`, `staff.read` or `staff.manage`.
- **One profile and one settings row per atelier**, created in the onboarding transaction. Migration `0006` backfills existing ateliers before enabling RLS (the owner role is subject to `FORCE ROW LEVEL SECURITY`). Services can rely on the rows existing.
- **Opening hours** are minutes since local midnight in the tenant's timezone, replaced as a whole week by `PUT`. Overlaps are rejected by the Zod contract; a CHECK constraint enforces the range. There is no exclusion constraint, because the replace-all transaction is the only writer.
- **Holidays** are `date` values, unique per atelier.
- **Staff rules:** nobody changes their own membership or the owner's; the owner role is never assigned; disabling revokes that membership's sessions after commit.
- Settings and staff live in the existing `tenants` module rather than separate `memberships/` and `settings/` modules (`API_STANDARDS.md` §3), because invitations already live there and the code is small.
**Consequences:** One more access mode to understand. Moving the staff code to `memberships/` later is a mechanical refactor.

## ADR-025 — Custom role editing without privilege escalation
**Status:** Accepted (2026-11-11, product owner approved the Phase 3 step 3 scope)
**Context:** §7.2 lets ateliers clone and edit roles. `roles.manage` is held by Admins as well as Owners, so editing must not become a way to gain access the editor does not have.
**Decision:**
- The caller may only add or remove permissions they hold (`permissionChangeProblems`, unit-tested). Owner-only permissions are never put on another role. Unknown strings are rejected with `VALIDATION_FAILED`.
- The Owner role cannot be changed. Other system roles can be edited but not deleted. Custom roles get a generated key `custom-<8 hex>`.
- Deleting a role with members or pending invitations is refused (`ROLE_IN_USE`). Membership foreign keys are `RESTRICT`, so a concurrent assignment makes the delete fail rather than orphan a member.
- Name uniqueness (case-insensitive) is checked in the service, not constrained in the database. Two concurrent creates can both succeed; this is accepted for now and marked with a `shortcut:` comment.
- No migration: `role` and `role_permission` already exist.
**Consequences:** An Admin cannot edit a role beyond their own permission set, even when that role holds more. Only the Owner can manage those.

## ADR-026 — CRM: clients, notes and communications
**Status:** Accepted (2026-11-11, product owner approved the Phase 3 step 4 scope, including non-unique client emails)
**Context:** The dashboard needs client profiles, internal notes and a communication log, with fast search at 10k clients per atelier.
**Decision:**
- `client`, `client_note` and `communication` are tenant tables (migration `0007`). Notes and communications reference their client and their author through composite `(tenant_id, …)` foreign keys.
- **Client emails are not unique.** Families often share one; duplicates are found by search.
- **Clients are archived, never deleted.** Archive and restore are idempotent; lists hide archived clients unless `status=archived|all`.
- **Notes are never edited.** Only the author may delete one, and a note id must belong to the client in the path.
- **Search** is a case-insensitive substring match on first name, last name, email and phone. First name, last name and phone have `pg_trgm` GIN indexes. They are not tenant-leading (a GIN trigram index cannot lead with a uuid without `btree_gin`); the tenant filter still comes from RLS and the scoped client. Email (citext) has no trigram index. A tenant's rows are bounded, so the match stays cheap.
- **Pagination** is keyset on `(created_at DESC, id DESC)` with an opaque base64url cursor (`core/http/cursor.ts`). A malformed cursor is a 422.
- The cross-tenant suite gained `fresh` fixtures: kinds whose own-id control deletes them get a new id per request.
**Consequences:** Notes and communications lists return the latest 200 without pagination (marked with `shortcut:`). Attachments, design references and order history arrive with uploads and Phase 4.

## ADR-027 — Measurements: versioned templates and immutable records
**Status:** Accepted (2026-11-11, product owner approved the Phase 3 step 5 scope and supplied the paper forms used as defaults)
**Context:** Measurements must never be lost or overwritten (`PRODUCT_REQUIREMENTS.md` rule 2), templates differ per atelier and garment, and Q2 fixed values at `numeric(7,3)` with the unit on each record.
**Decision:**
- Tables: `garment_category`, `measurement_template` (category + version), `measurement_field` (key, label, optional section, order, required), `measurement_record`, `measurement_value` (migration `0008`).
- **The current template is the highest version.** `UNIQUE(tenant_id, category_id, version)` makes concurrent saves safe: one wins, the other gets `409 TEMPLATE_CHANGED`. There is no `is_current` flag to keep in sync.
- **Templates, fields, records and values are immutable**, enforced by `forbid_mutation()` triggers (from `0002`), including TRUNCATE on records and values. Corrections are new records with `supersedes_id`; `UNIQUE(tenant_id, supersedes_id)` keeps one linear chain per record, and a correction must belong to the same client.
- **Field keys** are stable within a template and may carry a section prefix (`trouser.waistline`), because forms repeat labels across sections. Values are positive decimal strings with up to 3 decimals; there is no per-field min/max, since one range cannot fit both cm and inches.
- **Defaults:** onboarding seeds two categories modelled on the product owner's paper forms: "Barong / Suit" (Suit, Vest, Trouser, Dress Shirt; 26 fields) and "Gown / Dress" (Gown, Pants; 28 fields). Existing ateliers (development data only) are not backfilled.
- **Permissions:** categories and templates need `tenant.settings`; records need `measurements.read`/`measurements.write`. No new permission was added.
- `MeasurementsModule` uses `ClientsService` and `TenantSettingsService` (exported) instead of reading their tables.
**Consequences:** Unit conversion and storefront viewing are not built. Order items will snapshot records in Phase 4.
