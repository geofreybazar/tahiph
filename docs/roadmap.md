# Roadmap

The owner approved this documentation on 2026-10-31. Phase 0 is in progress. Items marked *(Approved)* are additions to the original brief, approved that day.

## Phase 0: Foundation

### Monorepo and configuration

- [x] npm workspaces and Turborepo
- [x] Root config: `tsconfig.base.json`, `.editorconfig`, `.prettierrc`, `.gitignore`, `.env.example`
- [x] `apps/api`, `apps/admin`, `apps/web` configured
- [x] `packages/shared`, proven importable by NestJS (CJS) and by Vite and Next.js (ESM)
- [x] Version compatibility settled: NestJS, `nestjs-zod`, `nestjs-cls`, Prisma 7.10.1 (ADR 0008)
- [x] CI: lint, typecheck, test, build *(Approved)*

### Database

- [ ] Supabase project, or local Supabase through Docker
- [ ] `tahi_migrator` and `tahi_api` roles
- [ ] Default grants revoked; `public` removed from the Data API
- [ ] Prisma 7.10.1, with `prisma.config.ts` and `adapter-pg`
- [ ] Pooled connection tested under load *(settles the `pgbouncer` question)*
- [ ] Foundation tables: `tenants`, `users`, `platform_admins`, `tenant_memberships`, `tenant_invitations`, `media_files`, `document_counters`, `audit_logs` *(Approved)*
- [ ] Seed script with two tenants

### Authentication and authorization

- [ ] JWT verification through JWKS, with all checks in `docs/security.md` §2
- [ ] Tenant context with `nestjs-cls`
- [ ] Membership lookup, `X-Tenant-Id` validation
- [ ] Role guards and permission map
- [ ] `platform_admins` guard; separate from membership
- [ ] MFA for super-admin *(Approved)*
- [ ] `GET /me`

### Prisma tenant isolation

- [ ] Tenant model registry and registry-versus-metadata test
- [ ] Scoped client extension, covering every operation in `docs/security.md` §4
- [ ] Fail-closed behaviour for missing context and unknown operations
- [ ] Nested write and global-traversal check
- [ ] Raw SQL blocked on the scoped client
- [ ] Identity and platform clients, with import restrictions

### Storage

- [ ] Buckets and limits
- [ ] Reusable storage service
- [ ] Intent, upload, confirm flow
- [ ] Abandoned upload cleanup *(Approved)*

### Application shells

- [x] API: envelope, exception filter, Zod validation, Swagger, CORS, `/health` (database check still to add)
- [ ] Admin: sign-in, tenant switcher, role-based routing, layout
- [x] Web: `proxy.ts` hostname resolution, placeholder site on `demo.localhost:3000` (API lookup still to add, needs the database)

### Security tests

- [ ] Cross-tenant isolation matrix
- [ ] Composite foreign key test
- [ ] RLS audit test
- [ ] Data API access test
- [ ] Role and staff restriction tests
- [ ] Storage cross-tenant test

### Documentation

- [ ] Replace "planned" commands with the real ones
- [ ] Resolve every *Verify in Phase 0* item in the docs

## Phase 1: MVP

*(Approved)* Build in this order, and put each slice in front of one pilot designer as it's finished. The first five modules are the core: they're what would replace a designer's notebook and spreadsheet. Nothing is cut; only the order is proposed.

### Core slice

- [ ] Tenant onboarding
- [ ] User and membership management
- [ ] Minimal super-admin: create, suspend, activate tenants *(Approved)*
- [ ] Client management
- [ ] Wedding projects
- [ ] Garment management
- [ ] Order management, as a view over projects
- [ ] Production tracking
- [ ] Measurement profiles and history

### Money

- [ ] Payment schedules
- [ ] Payment tracking
- [ ] Expenses

### Scheduling and insight

- [ ] Appointments and fittings
- [ ] Business dashboard
- [ ] Basic reports

### Before the first real tenant *(Approved)*

- [ ] Supabase paid plan and backups, with one practised restore
- [ ] Custom SMTP
- [ ] Render always-on plan
- [ ] Error monitoring
- [ ] Privacy lawyer review; processing agreement, retention and erasure decisions (`docs/security.md` §10)
- [ ] `tahi.ph` wildcard DNS decision

## Phase 2: Client-facing

- [ ] Public designer websites
- [ ] Portfolio management
- [ ] Collections and packages
- [ ] Inquiry forms
- [ ] Consultation booking
- [ ] Rate limiting and spam protection on public forms *(Approved)*
- [ ] Public image metadata removal *(Approved)*
- [ ] Client portal
- [ ] Order tracking
- [ ] Fitting schedules
- [ ] Payment visibility
- [ ] Notifications

## Phase 3: SaaS-ready

- [ ] Subscription management
- [ ] PayMongo integration
- [ ] Custom domains and verification
- [ ] Usage limits
- [ ] Automated reminders
- [ ] Advanced reports
- [ ] Tenant analytics
- [ ] Operational optimization
- [ ] Super-admin: plans, usage monitoring, account management

## Roadmap risk *(Approved)*

Phase 1 has around 15 modules for one part-time developer, and subscriptions don't arrive until Phase 3, so the work could run a long time with no user or revenue. A pilot designer using the core slice gives early proof without removing scope. The owner may also want to consider manual billing for early tenants, before PayMongo.
