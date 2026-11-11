# TAHI.ph

Multi-tenant SaaS platform for fashion designers, bespoke tailors and bridal ateliers. It covers client and measurement management, appointments, quotations, orders, production tracking, payments, and a branded public storefront for every atelier.

> **Status:** Phase 1 (project foundation) is in review. No business features yet.

## Interfaces

| Interface | Host |
|---|---|
| Atelier dashboard | `app.tahi.ph` |
| Public storefronts | `{atelier}.tahi.ph`, custom domains (future) |
| Platform administration | `admin.tahi.ph` |

## Planned stack

Next.js (App Router) · React · TypeScript · Tailwind · shadcn/ui · TanStack Query · React Hook Form · Zod · NestJS · Prisma · PostgreSQL · Redis · BullMQ · Docker Compose · Traefik · Cloudflare · GitHub Actions · GHCR · PayMongo · Resend · S3-compatible storage (R2)

## Documentation

| Document | Purpose |
|---|---|
| [Product requirements](docs/PRODUCT_REQUIREMENTS.md) | Scope, roles, workflows, open questions |
| [System architecture](docs/SYSTEM_ARCHITECTURE.md) | Apps, packages, routing, runtime |
| [Multi-tenancy](docs/MULTI_TENANCY.md) | Tenant isolation design |
| [Authentication & authorization](docs/AUTHENTICATION_AND_AUTHORIZATION.md) | Realms, sessions, RBAC |
| [Database design](docs/DATABASE_DESIGN.md) · [ERD](docs/DATABASE_ERD.md) | Entities, constraints, policies |
| [API standards](docs/API_STANDARDS.md) | Modules, contracts, errors |
| [Payment architecture](docs/PAYMENT_ARCHITECTURE.md) | Ledgers, PayMongo, webhooks |
| [Security](docs/SECURITY.md) | Threat model and controls |
| [Docker architecture](docs/DOCKER_ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [CI/CD](docs/CI_CD.md) | Infrastructure |
| [Backup & recovery](docs/BACKUP_AND_RECOVERY.md) | RPO/RTO, procedures |
| [Roadmap](docs/DEVELOPMENT_ROADMAP.md) · [ADRs](docs/ARCHITECTURAL_DECISIONS.md) · [Risks](docs/TECHNICAL_RISKS.md) | Planning |

## Repository layout

```
apps/dashboard     Next.js — atelier workspace (app.tahi.ph)              :3001
apps/storefront    Next.js — public tenant sites (*.tahi.ph)              :3002
apps/admin         Next.js — platform administration (admin.tahi.ph)      :3003
apps/api           NestJS API (src/main.ts) + worker (src/main.worker.ts) :3000
packages/database  Prisma schema, migrations, client factory
packages/validation, types, utils, ui, config
infrastructure/    Dockerfiles, Traefik, Postgres init, scripts
```

## Getting started

Requirements: Node.js 24 (`nvm use`), npm 11, Docker Engine with Compose v2.

```bash
npm ci
cp .env.example .env                    # local infrastructure passwords
cp apps/api/.env.example apps/api/.env  # API env (match the passwords above)
docker compose up -d                    # postgres :5432, redis :6379, mailpit :8025
DATABASE_URL=postgresql://tahi_owner:<owner-pw>@127.0.0.1:5432/tahi npm run db:migrate:deploy
npm run dev                             # all apps in watch mode
```

Migrations run as `tahi_owner`; the API connects as the least-privilege `tahi_app` role. Set `ENCRYPTION_KEYS` in `apps/api/.env` (`echo "k1:$(openssl rand -base64 32)"`). Emails land in Mailpit at http://127.0.0.1:8025.

| Command | What it does |
|---|---|
| `npm run dev` | Start every app in watch mode |
| `npm run lint` / `typecheck` / `test` / `build` | Run across all workspaces via Turborepo |
| `npm run test:int` | API integration tests (needs `DATABASE_URL` + `REDIS_URL`) |
| `npm run format` | Prettier |
| `npm run db:generate` / `db:migrate:dev` / `db:migrate:deploy` | Prisma |
| `npm run dev:worker -w @tahi/api` | Run the background worker |
| `npm run db:drift` | Check migrations match `schema.prisma` |
| `printf '%s' "$PW" \| npm run create-super-admin -w @tahi/api -- --email … --name …` | Create the first platform Super Admin (once) |

Health endpoints: `GET /api/health/live`, `GET /api/health/ready` (API); `GET /healthz` (each Next app).
