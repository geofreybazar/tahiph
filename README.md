# TAHI.ph

Multi-tenant SaaS platform for fashion designers, bespoke tailors and bridal ateliers. It covers client and measurement management, appointments, quotations, orders, production tracking, payments, and a branded public storefront for every atelier.

> **Status:** Phase 0 — architecture in review. There is no application code yet.

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

## Getting started

Setup instructions will be added in Phase 1.
