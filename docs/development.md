# Development

> Everything below works locally. No hosted environment exists yet, so the hosted checklist is untested.

Repository: <https://github.com/geofreybazar/tahiph.git>. It is **public**, so never commit real credentials, project references or customer data.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 LTS line | |
| npm | Bundled with Node | **npm only. Never pnpm or yarn** |
| Docker | Current | Needed for local Supabase, the API tests and API image builds |
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
npx supabase start     # first run downloads several Docker images
npx supabase status    # copy the publishable and secret keys into .env
npm run db:deploy
npm run db:seed
npm run dev
```

All apps read the one `.env` at the repository root.

If `docker` reports `permission denied`, run `sudo usermod -aG docker $USER`, then `wsl --shutdown` from Windows.

### Local accounts

`npm run db:seed` creates these, all with the password `local-dev-password`. It refuses to run against anything but a local database.

| Email | Access |
|---|---|
| `owner@demo.test` | Owner of Demo Atelier |
| `staff@demo.test` | Staff of Demo Atelier |
| `owner@other.test` | Owner of Other Atelier |
| `both@demo.test` | Admin of Demo Atelier, staff of Other Atelier |
| `admin@tahi.test` | Platform admin. The Platform page sets up MFA with an authenticator app on first use |

Local emails, including invitations and password resets, land in Mailpit at `http://localhost:54324`.

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

### API and database

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
| `DIRECT_URL` | `tahi_migrator`, session or direct. Read by `prisma.config.ts`. Only needed where migrations run |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | Storage and Auth admin operations. **Server only** |
| `ADMIN_APP_URL` | Base of invitation links, such as `https://app.tahi.ph` |
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

## Supabase setup

### Local

`npx supabase start` runs the Supabase stack in Docker. Bucket definitions go in `supabase/config.toml`, for example:

```toml
[storage.buckets.private-media]
public = false
file_size_limit = "25MiB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
```

### Hosted project checklist

Not yet run. `supabase/roles.sql` is for local use and CI only; hosted roles need their own strong passwords.

1. Create the project in the chosen region (Singapore recommended).
2. Enable asymmetric JWT signing keys.
3. Create `tahi_migrator` and `tahi_api` with separate strong passwords, and grant `BYPASSRLS` to `tahi_api` only.
4. Revoke default privileges for `anon`, `authenticated` and `service_role` in `public`.
5. Remove `public` from the Data API's exposed schemas.
6. Create the buckets, with limits.
7. Set the site URL to `https://app.tahi.ph`, redirect URLs for `app.tahi.ph/**` and `*.tahi.ph`, and enable TOTP MFA.
8. Configure custom SMTP. The built-in provider allows 2 emails per hour.
9. Run `npm run db:deploy`.
10. Run the RLS audit test against the project.

### First deploy

Not yet run. The configuration is in the repository; these steps need the owner's accounts.

**API on Render.** Create a Blueprint from `render.yaml`, and enter these when prompted:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `tahi_api`, over the transaction pooler |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_JWT_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
| `SUPABASE_JWKS_URL` | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_SECRET_KEY` | The project's secret key |
| `TRUST_PROXY_HOPS` | Confirm against Render's real setup. Too high lets clients spoof their address |

Render doesn't deploy by itself (`autoDeployTrigger: off`). Copy the service's deploy hook URL for the next step.

**Migrations and API releases.** Add a `production` environment to the GitHub repository with these secrets, then run the **Deploy API** workflow by hand after CI passes on `main`. It migrates, then deploys.

| Secret | Value |
|---|---|
| `DIRECT_URL` | `tahi_migrator`, over the session pooler or a direct connection |
| `RENDER_DEPLOY_HOOK` | The URL from Render. Anyone holding it can trigger a deploy |

**Frontends on Vercel.** Create one project per app, with the root directory set to `apps/admin` or `apps/web`. Each app's `vercel.json` sets its build.

| Project | Variable | Value |
|---|---|---|
| admin | `VITE_API_URL` | `https://api.tahi.ph/api/v1` |
| admin | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| admin | `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key only |
| web | `API_URL` | `https://api.tahi.ph/api/v1` |
| web | `ROOT_DOMAIN` | `tahi.ph` |

Vercel deploys from Git on its own, so a frontend can go live before the **Deploy API** workflow finishes. Until that's automated, run the workflow as soon as a change that needs a new API is merged, and keep API changes backward compatible.

## Testing

| Level | What | Database |
|---|---|---|
| Unit | Business rules, money, date boundaries | None |
| Integration | Services, tenant isolation, composite foreign keys, RLS audit | Real Postgres |
| API | Guards, roles, envelope, validation | Real Postgres |

A mocked database can't test tenant isolation. The tests use Vitest. `npm run test` needs local Supabase running, and recreates a separate `tahi_test` database each run. CI uses plain Postgres 17 with the same roles.

The API image builds from the repository root: `docker build -f apps/api/Dockerfile .`

## Troubleshooting

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
| Docker `permission denied` | User isn't in the `docker` group | See Getting started |
| `prisma migrate deploy` says permission denied for database | `tahi_migrator` lacks `CREATE` on the database | See `supabase/roles.sql` |
