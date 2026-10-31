# apps/api

NestJS modular monolith. REST under `/api/v1`. **The only app that accesses PostgreSQL.** Shell built in Phase 0.

Read first: `docs/security.md`, `docs/api.md`, `docs/schema.md`, `docs/database-conventions.md`.

## Structure (planned)

```text
src/
├── common/
│   ├── auth/         JWT verification, identity client, permission map
│   ├── guards/  decorators/  filters/  interceptors/
│   ├── tenant/       CLS context, runInTenant
│   ├── prisma/       scoped client, registry, nested write check
│   ├── storage/      reusable storage service
│   └── logging/
└── modules/<feature>/
    ├── <feature>.module.ts
    ├── <feature>.controller.ts
    ├── <feature>.service.ts
    ├── <feature>.repository.ts
    └── <feature>.spec.ts
prisma/
├── schema.prisma
└── migrations/
prisma.config.ts
```

Modules: tenants, members, clients, projects, garments, measurements, appointments, payments, expenses, dashboard, reports, media, platform. Phase 2 adds public-sites, content, inquiries, portal and notifications. There's no orders module (ADR 0007).

## Boundaries

- Controllers: HTTP, guards and schemas only.
- Services: business rules.
- Repositories: Prisma calls for that module's own tables only.
- Other modules are reached only through their exported services.
- Shared code goes in `common/` only when it's truly cross-cutting.

## Tenant safety

- Inject only the scoped client in feature modules. Never import the identity or platform client.
- Never read `tenantId` from a body or query. It comes from the context.
- For a new tenant model: composite foreign keys, `@@unique([tenantId, id])`, registry entry, RLS in the migration, and a cross-tenant test.
- Nested writes are refused; use a transaction with separate calls. Await queries inside the tenant context, because Prisma promises are lazy.
- Don't traverse from `User` or another global model into tenant models in `include` or `select`.
- Raw SQL: only in a repository, with `tenant_id` filtered explicitly, and flagged for security review.
- Scheduled jobs use `runInTenant`. Missing context must fail.

## Authorization

- Default deny: every route is authenticated unless explicitly marked public.
- Use the permission map, not scattered role strings.
- Financial data: staff-accessible responses use staff-safe schemas and include no tenant-wide totals.

## Money and time

- Integer centavos. Balances are derived from non-voided payments.
- Payment and refund writes that have a client retry risk use `Idempotency-Key` (Approved).
- Report period boundaries use Asia/Manila.

## Errors and responses

- Use the shared exception classes and codes from `docs/api.md`; the global filter builds the envelope.
- Never leak stack traces, SQL or another tenant's existence.
- Logs never include tokens, measurements or signed URLs.

## Testing

- Isolation and authorization tests run against real Postgres.
- Every module needs: happy path, validation, role denial, and cross-tenant denial.
- Run `db:migrate` and `db:seed` only locally.
