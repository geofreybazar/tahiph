# Development

> **Phase 0 is in progress.** The root commands work. Database and Supabase steps are **planned; not yet configured**.

Repository: <https://github.com/geofreybazar/tahiph.git>. It is **public**, so never commit real credentials, project references or customer data.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS line | |
| npm | Bundled with Node | **npm only. Never pnpm or yarn** |
| Docker | Current | Needed for local Supabase and API image builds. Not yet installed on the owner's WSL2 machine; use Docker Desktop's WSL integration or Docker Engine in WSL |
| Supabase CLI | Current | Run through `npx supabase`, or a dev dependency |
| Git and GitHub CLI | Current | |

### Versions to pin

Checked on npm on 2026-10-31.

| Package | Plan | Why |
|---|---|---|
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | Exactly `7.10.1` | npm's `latest` tag points to a release candidate, `8.0.0-rc.29` |
| `@nestjs/*` | **11.x**, unless compatibility is shown otherwise | npm's latest is 12.3.2, but `nestjs-zod` 5.5.0 declares support for Nest 10 and 11 only. See ADR 0008. `@nestjs/schedule` is 6.x on this line |
| `typescript` | **6.0.x** | npm's latest is 7.0.2, but `typescript-eslint` 8.72 requires below 6.1 |
| `nestjs-zod` | `5.5.0` or newer compatible | *Approved* |
| `zod` | 4.x | |
| `next` | 16.x | Uses `proxy.ts` |

## Getting started

```bash
git clone https://github.com/geofreybazar/tahiph.git
cd tahiph
npm install
cp .env.example .env
npm run dev
```

The database steps (`npx supabase start`, `db:generate`, `db:migrate`, `db:seed`) are planned and will go before `npm run dev`.

All apps read the one `.env` at the repository root.

| App | URL |
|---|---|
| API | `http://localhost:4000/api/v1` |
| API docs | `http://localhost:4000/api/docs` |
| Admin | `http://localhost:5173` |
| Web | `http://demo.localhost:3000` |

Browsers generally resolve `*.localhost` to the local machine, so `demo.localhost:3000` shouldn't need a hosts-file entry. Tools like `curl` may need `--resolve` or a `Host` header.

## Commands

### Root (configured)

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Run all apps |
| `npm run build` | Build all |
| `npm run lint` | Lint all |
| `npm run test` | Run all tests |
| `npm run typecheck` | Type-check all |

### API and database (planned; not yet configured)

| Command | Purpose | Target |
|---|---|---|
| `npm run db:generate` | Generate Prisma client | n/a |
| `npm run db:migrate` | `prisma migrate dev` | **Local only** |
| `npm run db:deploy` | `prisma migrate deploy` | CI/deploy, or a shared database |
| `npm run db:seed` | Load development data, with two tenants | **Local only** |

## Environment variables

Placeholders only. `.env.example` is created in Phase 0.

### `apps/api`

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | API port |
| `DATABASE_URL` | `tahi_api`, through the transaction pooler |
| `DIRECT_URL` | `tahi_migrator`, session or direct. Read by `prisma.config.ts` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Storage operations. **Server only** |
| `SUPABASE_JWT_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
| `SUPABASE_JWKS_URL` | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `CORS_ORIGINS` | Comma-separated exact origins |
| `TRUST_PROXY_HOPS` | Number of proxies in front of the API |
| `INTERNAL_SERVICE_KEY` | Authenticates `apps/web` for forwarded client IP. Server only |

### `apps/admin` (public by design)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL |
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key |

### `apps/web`

| Variable | Purpose |
|---|---|
| `API_URL` | API base URL, server only |
| `ROOT_DOMAIN` | `localhost:3000` or `tahi.ph` |
| `INTERNAL_SERVICE_KEY` | Server only |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |

Any variable prefixed `VITE_` or `NEXT_PUBLIC_` reaches the browser. Never put a secret there.

Turborepo's environment handling must declare these variables, or builds can use stale cache results.

## Supabase setup (planned)

### Local

`npx supabase start` runs the Supabase stack in Docker. Bucket definitions go in `supabase/config.toml`, for example:

```toml
[storage.buckets.private-media]
public = false
file_size_limit = "25MiB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
```

### Hosted project checklist

1. Create the project in the chosen region (Singapore recommended).
2. Enable asymmetric JWT signing keys.
3. Create `tahi_migrator` and `tahi_api` with separate strong passwords, and grant `BYPASSRLS` to `tahi_api` only.
4. Revoke default privileges for `anon`, `authenticated` and `service_role` in `public`.
5. Remove `public` from the Data API's exposed schemas.
6. Create the buckets, with limits.
7. Set redirect URLs for `app.tahi.ph` and `*.tahi.ph`.
8. Configure custom SMTP. The built-in provider allows 2 emails per hour.
9. Run `npm run db:deploy`.
10. Run the RLS audit test against the project.

## Testing (planned)

| Level | What | Database |
|---|---|---|
| Unit | Business rules, money, date boundaries | None |
| Integration | Services, tenant isolation, composite foreign keys, RLS audit | Real Postgres |
| API | Guards, roles, envelope, validation | Real Postgres |

A mocked database can't test tenant isolation. A test framework is chosen in Phase 0.

## Troubleshooting (expected issues; confirm in Phase 0)

| Symptom | Likely cause | Check |
|---|---|---|
| API sees no rows, with no error | `tahi_api` lacks `BYPASSRLS`; RLS with no policies returns nothing | `\du` |
| `prisma migrate` hangs or errors | Using the transaction pooler | Use `DIRECT_URL` |
| Prepared statement errors | Transaction pooler with named prepared statements | See `docs/database-conventions.md` |
| Direct connection fails from WSL or Render | Direct host may need IPv6 | Use session pooler |
| Valid token rejected | Wrong issuer or audience, or the project still uses HS256 | Decode the token header and claims |
| `TENANT_ACCESS_DENIED` for a member | Stale selected tenant, or inactive membership | `GET /me` |
| Unknown tenant on `demo.localhost` | Seed not run, or `ROOT_DOMAIN` wrong | Check the `tenants` table |
| Invitation emails stop | Built-in email rate limit | Configure SMTP |
| Import errors from `packages/shared` | CJS and ESM mismatch | Build the shared package |
| Docker command not found in WSL | Docker isn't installed or integrated | Install it, then retry |
