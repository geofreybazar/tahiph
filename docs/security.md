# Security

This file owns TahiPh's security rules. Other documents summarize and link here.

**Status labels:** *Established* = set by the owner's brief. *Confirmed* = chosen by the owner on 2026-10-31. *Approved* = recommended in the review and approved by the owner on 2026-10-31. *Verify in Phase 0* = not yet proven; do not rely on it until a test does.

## 1. Threats that matter most

1. One designer sees another designer's clients, money, measurements or photos.
2. Staff see restricted financial data.
3. A client sees another client's project.
4. A service-role key or database credential leaks.
5. Personal data is kept, exposed or lost in breach of the Data Privacy Act.

## 2. Authentication (Established)

Supabase Auth issues tokens. `apps/api` verifies them on every protected request.

| Check | Rule |
|---|---|
| Signature | Verified against `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| Algorithm | Explicit allowlist of the project's asymmetric algorithm. HS256 and `none` are rejected |
| Issuer | `https://<project-ref>.supabase.co/auth/v1` |
| Audience | `authenticated` |
| Expiry | `exp` enforced |

- The project must use asymmetric JWT signing keys.
- The API never receives or stores refresh tokens. `apps/admin` refreshes through `supabase-js`; `apps/web` refreshes through Supabase's server-side session cookies.
- **A token stays valid until it expires, even after sign-out or removal.** So every tenant request reloads membership and tenant status from the database. Removing a member or suspending a tenant takes effect on the next request. A short in-process cache is allowed only if it is under 60 seconds and documented where it is added.
- Roles and tenant IDs are never read from `user_metadata`, request bodies or frontend state.
- `users.id` equals the JWT `sub`. A `users` row is created on first verified request. Email matching (for invitations) requires a verified email.

### Super-admin (Established; MFA Approved)

- Stored in `platform_admins`, separate from tenant membership. No tenant role ever grants platform access, and the reverse.
- platform endpoints require MFA (`aal` claim equal to `aal2`).
- every platform action writes an `audit_logs` row.

### Admin app token storage

`apps/admin` is a single-page app, so its session is readable by JavaScript and any XSS can steal it. a strict Content-Security-Policy on `apps/admin`, no `dangerouslySetInnerHTML` on user content, and few third-party scripts.

## 3. Authorization

Every request passes through, in order:

1. JWT verification.
2. Context selection:
   - Dashboard: `X-Tenant-Id` header, treated only as a *request*, validated against membership.
   - Portal: tenant slug in the path, validated against `client_portal_access`.
   - Platform: `platform_admins` lookup, with no tenant context.
3. Role or permission guard.
4. Tenant-scoped service call.

Rules:

- A missing `X-Tenant-Id` on a tenant route returns `400 TENANT_REQUIRED`.
- A tenant the user can't access returns `403 TENANT_ACCESS_DENIED`, whether or not it exists.
- A record belonging to another tenant returns `404`, so its existence is not revealed.
- A suspended tenant returns `403 TENANT_SUSPENDED` to members and clients. Super-admins are unaffected.

### Role matrix

| Capability | owner | admin | staff |
|---|---|---|---|
| Transfer ownership, change an admin's role | Yes | No | No |
| Manage members | Yes | Staff only | No |
| Clients, projects, garments, measurements, appointments | Yes | Yes | Yes |
| View a single client's or project's price, schedule, payments and balance | Yes | Yes | Yes |
| Record a payment on a project | Yes | Yes | Yes |
| Void a payment, change a project's price | Yes | Yes | No |
| Tenant-wide payment list, revenue, profit, total receivables, reports | Yes | Yes | **No** |
| Expenses | Yes | Yes | **No** |

The staff money rule carries over from the owner's 2026-10-27 decision: staff see per-client money but not totals, revenue, profit or expenses. `docs/api.md` must agree with this table.

### Enforcing financial restrictions

Hiding a field in the UI is not a control.

- Restricted data lives behind owner/admin-only endpoints, or in role-specific response schemas.
- An endpoint open to staff must never return a tenant-wide total, even in `meta`.
- one permission map in `apps/api/src/common/auth/permissions.ts` (`can(role, permission)`). Guards use it, and it becomes the seed for the future permission system. No database-driven permissions until that system is approved.

## 4. Tenant isolation (Established strategy)

**Application-layer tenant scoping + deny-all PostgreSQL RLS.**

### What each layer really protects

| Layer | Stops | Does not stop |
|---|---|---|
| Prisma tenant extension | A service forgetting `tenant_id` on a top-level operation | Nested operations, raw SQL, a wrong tenant in context |
| Composite foreign keys | A row linking to another tenant's row, from any code path | Reading the wrong tenant's rows |
| Deny-all RLS | `anon`/`authenticated` reaching tables through the Supabase Data API | **Anything the API does** |
| Cross-tenant tests | Regressions in the above | Code paths with no test |

> **Important limit.** With no permissive policies, a role subject to RLS sees zero rows, so the API's database role must have `BYPASSRLS`. Supabase's own Prisma guide also creates a `bypassrls` user. **RLS is therefore not a safety net for API bugs.** A Prisma scoping bug is stopped only by the extension, the composite foreign keys and the tests. Do not describe RLS as a second layer against application mistakes.

### Request flow

1. A `nestjs-cls` context starts for the request.
2. The auth guard verifies the JWT and loads the user.
3. Membership is checked through the **identity client** (below).
4. The tenant context `{ tenantId, actor, role }` is set.
5. Role guards run.
6. Services use the **scoped client**, which reads the context on every operation.

### Prisma clients

| Client | Scoping | May be imported by |
|---|---|---|
| Scoped (default) | Enforced | All feature modules |
| Identity | None; limited to the lookups needed before tenant context exists | `common/auth` only |
| Platform | None | `modules/platform` only |

ESLint import restrictions enforce this table, and CI fails on a violation.

### Tenant model registry

- An explicit list of tenant-owned models.
- A CI test compares the registry with Prisma's model metadata: any model with a `tenantId` field that isn't registered fails the build. Exceptions must be listed by name with a reason.
- A registered model with no tenant context **throws**. It never returns unscoped data.

### Extension behaviour by operation

| Operation | Behaviour |
|---|---|
| `findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany` | Add `tenantId` to `where` |
| `count`, `aggregate`, `groupBy` | Add `tenantId` to `where` |
| `create` | Set `tenantId` from context; reject a different supplied value |
| `createMany`, `createManyAndReturn` | Same, on every row |
| `update`, `delete` | Add `tenantId` to `where`; reject changes to `tenantId` in `data` |
| `updateMany`, `updateManyAndReturn`, `deleteMany` | Same |
| `upsert` | `where` and `create` as above; reject `tenantId` in `update` |
| Any operation not listed | **Reject on registered models** (fail closed, including new Prisma operations) |
| `$queryRaw`, `$executeRaw` and unsafe variants | Blocked on the scoped client by a top-level `$allOperations` hook |

Adding `tenantId` to a `findUnique`, `update` or `delete` `where` relies on Prisma accepting non-unique filters there. *Verify in Phase 0* with an isolation test on Prisma 7.10.1.

### What the extension cannot cover

Prisma's docs state the `query` extension does not support nested read and write operations. So:

- **Nested writes:** a recursive check inspects `data` and **rejects** `create`, `connect`, `connectOrCreate`, `update`, `upsert`, `delete`, `set` and `disconnect` on tenant-owned relations unless that path is on an explicit allowlist. Allowlisted nested `create` gets `tenantId` set by the check. Composite foreign keys are the real guarantee for `connect`.
- **Nested reads:** `include`, `select` and relation filters aren't filtered, but composite foreign keys keep tenant-to-tenant relations within one tenant, so they're safe.
- **Traversal through global models is the exception.** `membership.user.memberships` reaches other tenants through `User`. The same recursive check rejects `include`, `select` and relation filters that go from a global model to a tenant-owned one.
- **Raw SQL:** only in a repository that uses a named raw-query helper, must filter by `tenant_id` explicitly, and is flagged for security review in the PR.
- **Background jobs:** there is no request, so no context. Jobs must call an explicit `runInTenant(tenantId, fn)`. A job with no context fails.
- **Wrong tenant in context:** no database layer catches this. Guards and tests must.

### Required tests (CI, against a real Postgres)

- **Isolation matrix:** with two tenants, each operation in the table above on each tenant model cannot read or change the other tenant's data.
- **Module rule:** every feature module has a cross-tenant test before it merges.
- **Composite foreign key test:** linking across tenants fails at the database, using a raw insert.
- **RLS audit:** every table in `public`, including `_prisma_migrations`, has RLS enabled; `pg_policies` is empty for those tables; `anon` and `authenticated` hold no grants.
- **Data API test:** the publishable key can't read any table.
- **Staff test:** staff receive 403 on every financial endpoint and no restricted fields in shared ones.

## 5. RLS and database roles

| Role | Used by | Privileges |
|---|---|---|
| `tahi_migrator` | CI/deploy only, via `prisma migrate deploy` | Owns tables; DDL |
| `tahi_api` | Runtime API | `BYPASSRLS`; data access only; no DDL; not superuser |
| `anon`, `authenticated`, `service_role` | Supabase | No table grants on application tables |

Setup rules:

- `ENABLE ROW LEVEL SECURITY` on every application table, with no policies.
- Revoke Supabase's default grants, because tables created in `public` can receive `anon`/`authenticated`/`service_role` privileges by default. Revoke default privileges **and** check the result with the RLS audit test.
- Remove `public` from the Data API's exposed schemas. Application data is never reached through PostgREST.
- Table owners and `BYPASSRLS` roles skip RLS. `FORCE ROW LEVEL SECURITY` isn't used, because it would add nothing for `tahi_api` and would complicate migrations.
- Prisma doesn't manage RLS, so it goes in migration SQL (`docs/database-conventions.md`).

## 6. Storage

Buckets (Established): `public-media`, `private-media`.

| Rule | Detail |
|---|---|
| Object key | Generated by the API: `{tenant_id}/{purpose}/{media_file_id}.{ext}`. Client filenames never form part of the key |
| Overwrite | `upsert` is off |
| Download | Private files: signed URL after tenant and role checks, valid 60–300 seconds |
| Upload | Signed URL. Supabase documents these as valid for 2 hours, so `pending` records outlive that |
| Bucket limits | `public-media`: JPEG, PNG, WebP, 10 MiB. `private-media`: those plus PDF, 25 MiB |
| SVG | Not accepted (it can carry scripts) |
| Keys | The Supabase secret/service-role key lives in `apps/api` only |

**Signed upload URLs don't validate the individual file.** The documented MIME and size limits are per bucket, and the client's declared type can be false. So uploads have three steps:

1. **Intent:** the API checks role and purpose, creates a `media_files` row (`pending`), and returns the signed URL.
2. **Upload:** the client sends the file directly to Storage.
3. **Confirm:** the API checks the stored object's actual size and leading bytes, then marks it `ready` or deletes it.

Only `ready` files can be attached to records. a scheduled job removes `pending` files after 24 hours, and public images have EXIF/GPS data removed, because photos taken at a client's home can carry location data.

## 7. CORS and hostnames

Public website hostnames and API request origins are different things.

- `apps/web` calls the API **from its server**, so designer subdomains make no browser requests to the API and need no CORS entry.
- Only `apps/admin` calls the API from a browser. Allowed origins come from `CORS_ORIGINS`: `https://app.tahi.ph` in production, `http://localhost:5173` in development.
- Never `*`, never a `*.tahi.ph` pattern, never reflecting the request's `Origin`.
- The API uses bearer tokens, not cookies, so `credentials` stays off.
- Methods: `GET, POST, PATCH, DELETE, OPTIONS`. Headers: `Authorization, Content-Type, X-Tenant-Id, Idempotency-Key`.

### Portal sessions

- Session cookies are **host-only**. Never set `Domain=.tahi.ph`, which would send one designer's portal session to every designer's subdomain.
- Supabase redirect URLs need to allow `*.tahi.ph`. *Verify in Phase 0.* Custom domains need a separate login design in Phase 3.

### Caching

Public pages can be cached by host; portal pages can't. See `docs/architecture.md` §5. A cache entry not keyed by tenant is a cross-tenant leak.

## 8. Secrets

| Secret | Where it may exist |
|---|---|
| `DATABASE_URL` (`tahi_api`) | Render, local `.env` |
| `DIRECT_URL` (`tahi_migrator`) | CI/deploy step, local `.env` |
| `SUPABASE_SECRET_KEY` | Render, local `.env` |
| `INTERNAL_SERVICE_KEY` | Render and `apps/web` server environment |
| Supabase publishable key, `VITE_*`, `NEXT_PUBLIC_*` | Public by design; never put a secret under these prefixes |

- This repository is **public**. Commit only `.env.example`, with placeholders.
- secret scanning in CI.
- Rotate immediately on suspected exposure; the rotation steps go in `docs/development.md` once real values exist.
- Logs never contain tokens, measurements, payment proofs or signed URLs.

## 9. Public endpoints (Approved)

Inquiry and booking forms are open to the internet.

- Rate limit by client IP and tenant.
- Spam protection on forms (for example, Cloudflare Turnstile).
- Because `apps/web` calls the API from its server, the API sees Vercel's IP. The real client IP is forwarded in a header that the API trusts **only** alongside a valid `INTERNAL_SERVICE_KEY`.
- The API sets its trusted proxy count to match Render's actual setup. A wrong count makes rate limits bypassable by spoofing `X-Forwarded-For`.

## 10. Data Privacy Act (RA 10173) (Approved)

Client contact details, body measurements, fitting photos and payment records are personal data. Generally, each designer decides why it's collected (personal information controller) and Tahi processes it for them (personal information processor). **This is not legal advice; have a Philippine privacy lawyer confirm this section before onboarding real tenants.**

Before Phase 1 goes live, decide and document:

- A data processing agreement between Tahi and each designer.
- Retention periods, including what happens after a tenant cancels.
- Erasure and access requests: delete or anonymize personal data while keeping financial records the designer must retain.
- Breach handling, including who is notified and how quickly. Confirm the National Privacy Commission's requirements.
- Whether NPC registration applies to Tahi.

## 11. Operations (Approved)

- Error monitoring for all three apps, with personal data scrubbed.
- `audit_logs` for member changes, payment voids, price changes, tenant suspension and all platform actions.
- A written backup plan, with one **practised** restore before real tenants. A paid Supabase plan is required, since Free projects can be paused for low activity.
- Swagger is off in production, or behind authentication.
