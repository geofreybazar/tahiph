# Roadmap

The owner approved this documentation on 2026-10-31. Phase 0 is complete locally. No hosted environment exists yet. Items marked *(Approved)* are additions to the original brief, approved that day.

## Phase 0: Foundation

### Monorepo and configuration

- [x] npm workspaces and Turborepo
- [x] Root config: `tsconfig.base.json`, `.editorconfig`, `.prettierrc`, `.gitignore`, `.env.example`
- [x] `apps/api`, `apps/admin`, `apps/web` configured
- [x] `packages/shared`, proven importable by NestJS (CJS) and by Vite and Next.js (ESM)
- [x] Version compatibility settled: NestJS, `nestjs-zod`, `nestjs-cls`, Prisma 7.10.1 (ADR 0008)
- [x] CI: lint, typecheck, test, build *(Approved)*

### Database

- [x] Local Supabase through Docker (the hosted project comes before the first real tenant, in Phase 1)
- [x] `tahi_migrator` and `tahi_api` roles
- [x] Default grants revoked; `public` removed from the Data API
- [x] Prisma 7.10.1, with `prisma.config.ts` and `adapter-pg`
- [x] Pooled connection tested under load *(settles the `pgbouncer` question)*
- [x] Foundation tables: `tenants`, `users`, `platform_admins`, `tenant_memberships`, `tenant_invitations`, `media_files`, `document_counters`, `audit_logs` *(Approved)*, plus `clients` and `wedding_projects` (tables only), so composite foreign keys are tested against the real schema
- [x] Seed script with two tenants

### Authentication and authorization

- [x] JWT verification through JWKS, with all checks in `docs/security.md` §2
- [x] Tenant context with `nestjs-cls`
- [x] Membership lookup, `X-Tenant-Id` validation
- [x] Role guards and permission map
- [x] `platform_admins` guard; separate from membership
- [x] MFA for super-admin *(Approved)*
- [x] `GET /me`

### Prisma tenant isolation

- [x] Tenant model registry and registry-versus-metadata test
- [x] Scoped client extension, covering every operation in `docs/security.md` §4
- [x] Fail-closed behaviour for missing context and unknown operations
- [x] Nested write and global-traversal check
- [x] Raw SQL blocked on the scoped client
- [x] Identity and platform clients, with import restrictions

### Storage

- [x] Buckets and limits
- [x] Reusable storage service
- [x] Intent, upload, confirm flow
- [x] Abandoned upload cleanup *(Approved)*

### Application shells

- [x] API: envelope, exception filter, Zod validation, Swagger, CORS, `/health` 
- [x] Admin: sign-in, tenant switcher, role-based routing, layout
- [x] Web: `proxy.ts` hostname resolution, placeholder site on `demo.localhost:3000` 

### Security tests

- [x] Cross-tenant isolation matrix
- [x] Composite foreign key test
- [x] RLS audit test
- [x] Data API access test
- [x] Role and staff restriction tests
- [x] Storage cross-tenant test

### Documentation

- [x] Replace "planned" commands with the real ones
- [x] Resolve the *Verify in Phase 0* items in the docs; the portal redirect URL test moves to Phase 2

## Phase 1: MVP

*(Approved)* Build in this order, and put each slice in front of one pilot designer as it's finished. The first five modules are the core: they're what would replace a designer's notebook and spreadsheet. Nothing is cut; only the order is proposed.

### Core slice

- [x] Tenant onboarding
- [x] User and membership management
- [x] Minimal super-admin: create, suspend, activate tenants *(Approved)*
- [x] Client management (payment history arrives with Payment tracking)
- [x] Wedding projects (the derived balance arrives with Payment tracking)
- [x] Garment management
- [x] Order management, as a view over projects
- [x] Production tracking
- [x] Measurement profiles and history

### Money

- [ ] Payment schedules
- [ ] Payment tracking
- [ ] Expenses

### Scheduling and insight

- [ ] Appointments and fittings
- [ ] Business dashboard
- [ ] Basic reports

### Before the first real tenant *(Approved)*

- [ ] Hosted Supabase project, following `docs/development.md`
- [ ] First deploys to Render and Vercel
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
- [ ] Client portal, including a test of `*.tahi.ph` Supabase redirect URLs
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
