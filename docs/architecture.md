# Architecture

**Nothing here is built yet.** Security rules are in `docs/security.md`; rationale is in `docs/decisions/`.

## 1. System overview

```text
 Designers, staff, super-admin        Public visitors, clients
          │                                    │
          ▼                                    ▼
   apps/admin (Vite SPA)              apps/web (Next.js)
   app.tahi.ph                        designer.tahi.ph
   Vercel                             Vercel
          │  Bearer token + CORS               │  Server-side calls, no CORS
          │  X-Tenant-Id                       │
          ▼                                    ▼
        ┌──────────────────────────────────────────┐
        │  apps/api (NestJS modular monolith)      │
        │  api.tahi.ph/api/v1, Render + Docker     │
        └───────┬──────────────────────┬───────────┘
                │ Prisma               │ Secret key
                ▼                      ▼
        Supabase PostgreSQL     Supabase Storage

  Supabase Auth: both frontends sign in directly and get tokens.
  apps/api verifies those tokens against Supabase's JWKS.
```

`app.tahi.ph` and `api.tahi.ph` are the approved hostnames.

## 2. Application responsibilities

| App | Owns | Must not |
|---|---|---|
| `apps/api` | Business rules, authorization, all database access, signed storage URLs | Trust frontend roles or tenant IDs |
| `apps/admin` | Designer dashboard; super-admin panel; tenant switching | Access PostgreSQL or Storage keys directly |
| `apps/web` | Public sites, hostname resolution, client portal, SEO | Access PostgreSQL; cache private data |
| `packages/shared` | Zod schemas, inferred types, enums, constants, API contracts | Import NestJS, Prisma or server-only code |

**Only `apps/api` accesses PostgreSQL.**

## 3. API request flow

```text
Request
 → CORS, rate limit (Approved)
 → CLS context starts (nestjs-cls)
 → Auth guard: verify JWT, load user
 → Tenant guard: X-Tenant-Id → membership and tenant status (identity client)
 → Tenant context set: { tenantId, actor, role }
 → Role/permission guard
 → Zod validation
 → Controller → Service → Repository
 → Scoped Prisma client adds tenant_id on every operation
 → PostgreSQL
 → Response envelope / exception filter
```

Modules call each other through exported services and never read each other's tables. Details are in `docs/security.md` §4.

### Modules

```text
apps/api/src/
├── common/      auth, guards, decorators, filters, interceptors,
│                tenant context, prisma, logging, exceptions, storage
└── modules/     tenants, members, clients, projects, garments,
                 measurements, appointments, payments, expenses,
                 dashboard, reports, media, platform
                 (Phase 2: public-sites, content, inquiries, portal, notifications)
```

There is no `orders` module, because project = order (ADR 0007).

Scheduled jobs run through `@nestjs/schedule`. They have no request, so they must enter a tenant context explicitly. If the API ever runs more than one instance, each job also needs a database lock, or it will run once per instance.

## 4. Authentication flow

### `apps/admin`

```text
1. User signs in with supabase-js
2. supabase-js holds and refreshes the session
3. Each API call: Authorization: Bearer <access token>, X-Tenant-Id: <selected tenant>
4. API verifies the JWT against JWKS (signature, algorithm, issuer, audience, expiry)
5. API loads the user and memberships, sets the tenant context
```

**Tenant switching:**

1. `GET /me` returns the user's memberships.
2. Selecting a tenant changes only the client's selected tenant. No new token is issued.
3. All TanStack Query keys include the tenant ID, and switching clears the query cache, so one tenant's data never appears under another.
4. The last selection may be remembered in `localStorage`. It's a preference, and the API validates it on every request.

### `apps/web` client portal

```text
1. Client gets an invitation, signs in on designer.tahi.ph
2. Server-side Supabase client stores the session in host-only cookies
3. proxy.ts refreshes the session
4. Server component reads the access token and calls /portal/:slug/... as Bearer
5. API checks client_portal_access for this user + tenant
6. Only that client's records are returned
```

A person who's a client of two designers signs in separately on each subdomain, but has one Supabase user. See ADR 0009.

## 5. Tenant resolution (`apps/web`)

Next 16 uses `proxy.ts`, the replacement for the `middleware` file convention.

```text
Incoming host
 → skip Next.js internals and static assets (matcher)
 → lower-case; strip the port
 → apex or reserved subdomain? → not a tenant
 → must be exactly one label under the root domain
 → rewrite /path → /[site]/path
 → page calls GET /public/sites/resolve?host=...
      active    → render
      suspended → "unavailable" page, noindex
      inactive  → "unavailable" page, noindex
      unknown   → 404
```

| Environment | Root domain | Example |
|---|---|---|
| Development | `localhost:3000` | `http://demo.localhost:3000` |
| Production | `tahi.ph` | `https://designer.tahi.ph` |

**Reserved subdomains** live in `packages/shared`: `www`, `app`, `api`, `admin`, `portal`, `auth`, `mail`, `static`, `cdn`, `docs`, `status`, `support`, `help`, `blog`.

### Cache rules

The rewrite puts the site slug in the path, so ISR entries are naturally separate per tenant.

| Route | Rendering | Cache |
|---|---|---|
| Public site pages | ISR | Tagged `site:<tenantId>`; revalidated when content changes |
| Tenant profile lookup | Server fetch | Short revalidation, same tag |
| `/portal/**` | Dynamic | **Never cached**: `no-store`, no CDN caching |
| Public form submission | Server action/route | Never cached |

The API calls a protected revalidation route in `apps/web` when a designer publishes.

SEO values such as metadata, canonical URLs, `sitemap.xml` and `robots.txt` are generated per host. Unavailable sites are `noindex`.

The Host header is only trustworthy behind Vercel's routing. Anything `apps/web` derives from it must still pass through API resolution.

## 6. Storage flow

```text
Upload
  Client → API: POST /media/upload-intents   (purpose, type, size)
  API: check role → generate key → pending row → signed URL
  Client → Supabase Storage: upload
  Client → API: POST /media/:id/confirm
  API: check real size and leading bytes → ready, or delete
  Client → API: attach media to a record

Private download
  Client → API: GET /media/:id/download-url
  API: check tenant and parent record's access → signed URL (60–300 s)

Public media
  Stored in public-media under tenant_id/, served by public URL.
  Only content approved for publishing goes here.
```

Rules are in `docs/security.md` §6.

## 7. Deployment

| Component | Host | Notes |
|---|---|---|
| `apps/admin` | Vercel | Static SPA with a fallback rewrite to `index.html` |
| `apps/web` | Vercel | Wildcard `*.tahi.ph` |
| `apps/api` | Render, Docker | Always-on paid plan; free instances sleep. Docker keeps a VPS move possible |
| Database, Auth, Storage | Supabase | Paid plan before real tenants |

**Region:** run Render and Supabase in the same region. Singapore is the recommended default for Philippine users, with Vercel functions pinned nearby. Every API call and query crosses this link, so a mismatch slows everything.

**DNS:** Vercel's wildcard certificate needs Vercel's nameservers on `tahi.ph`, or a delegated `_acme-challenge` record if DNS stays elsewhere.

**Docker build:** use `turbo prune --docker` so the API image contains only what it needs.

**Release order:** CI passes → `prisma migrate deploy` as `tahi_migrator` → deploy API → deploy frontends. Migrations must stay backward compatible with the previous API version.

**Email:** Supabase's built-in provider allows only 2 emails per hour, so custom SMTP is required before invitations go to real users.

### Environments

| Environment | Supabase | Apps |
|---|---|---|
| Local | Supabase CLI (Docker), or a dedicated dev project | Local |
| Production | Paid project | Vercel, Render |

Add a staging Supabase project before real tenants. Never share a project between environments.

## 8. Custom domains (Phase 3)

Not designed in detail. The design needs: DNS ownership verification, Vercel's domains API, a `custom_domains` table consulted during resolution, and a separate portal login approach, because cookies and redirect URLs on `*.tahi.ph` won't cover them.
