# API Standards — TAHI.ph

> **Status:** Proposed (Phase 0).

## 1. Style

- REST over JSON, versioned by path: `/api/v1/...`
- Resources are plural nouns (`/orders`, `/orders/{id}/payments`).
- Actions that are not CRUD use a sub-resource verb: `POST /quotations/{id}/send`, `POST /quotations/{id}/convert`, `POST /appointments/{id}/reschedule`.
- IDs are UUIDs and are validated at the edge.
- Field names use `camelCase`. Timestamps are ISO-8601 UTC (`2026-11-11T03:00:00.000Z`). Dates are `YYYY-MM-DD`.
- Money is sent as **strings** with currency: `{ "amount": "15000.00", "currency": "PHP" }`, to avoid float errors in JS.

## 2. Route realms

| Prefix | Realm | Host | Auth |
|---|---|---|---|
| `/api/v1/auth/*` | tenant staff | app | public + session |
| `/api/v1/tenant/*` | tenant staff | app | session + permission |
| `/api/v1/public/*` | public | storefront hosts | none (tenant from Host), rate limited |
| `/api/v1/customer/*` | customer | storefront hosts | customer session |
| `/api/v1/platform/*` | platform | admin | admin session + MFA + permission |
| `/api/v1/webhooks/*` | provider | api.tahi.ph | signature |
| `/api/health/*` | — | internal | none |

## 3. Module structure (NestJS)

```
apps/api/src/
├── main.ts                    HTTP entrypoint
├── main.worker.ts             Worker entrypoint (no controllers)
├── core/
│   ├── config/                Zod-validated env
│   ├── context/               nestjs-cls RequestContext, tenant resolution middleware
│   ├── database/              PrismaModule: scoped + UNSCOPED clients, withTenantTx, db()
│   ├── auth/                  SessionGuard, RealmGuard, PermissionGuard, decorators
│   ├── http/                  ZodValidationPipe, exception filter, envelope interceptor
│   ├── logging/               nestjs-pino setup, redaction
│   ├── queue/                 BullMQ registration, TenantJobProcessor base
│   └── storage/               S3 client, presigned URLs
└── modules/
    ├── auth/                  login, logout, sessions, password reset, verification, MFA
    ├── users/                 profile, own sessions
    ├── tenants/               onboarding, settings, business profile, lifecycle
    ├── memberships/           invitations, staff management
    ├── roles/                 roles, permissions
    ├── clients/               CRM, notes, communications, design references
    ├── measurements/          categories, templates, records
    ├── appointments/          types, availability, booking, slots, reminders
    ├── catalog/               categories, products, services, options
    ├── quotations/
    ├── orders/
    ├── production/            workflows, stages, jobs, assignments, fittings, alterations
    ├── payments/              order payments, refunds, merchant accounts, provider adapters
    ├── billing/               SaaS plans, subscriptions, invoices (ledger A)
    ├── storefront/            public site config, portfolio, testimonials, inquiries, public endpoints
    ├── uploads/               presign, confirm, attachments
    ├── notifications/         in-app + email dispatch (enqueue)
    ├── reports/
    ├── audit/                 AuditLog, TenantAuditLog writers + readers
    ├── webhooks/              ingress + processors
    └── platform/              admin endpoints: tenants, plans, revenue, settings, support
```

The brief's `SubscriptionsModule` and `BillingModule` are merged into `billing/`, because they share one aggregate (Subscription → Invoice) and splitting them would create a circular dependency. `ProductsModule` is renamed `catalog/` (products, services and options share the option model).

**Dependency rules:**
- Modules interact through exported services, never by reaching into another module's Prisma models directly.
- Cycles are forbidden (checked with `madge` or `dependency-cruiser` in CI).
- Cross-module reactions (e.g. order confirmed → create production jobs, send email) use in-process domain events (`@nestjs/event-emitter`) or queue jobs, not direct calls back into the emitter.

## 4. Contracts and validation

- Each endpoint has request and response Zod schemas in `packages/validation/src/<module>/`.
- The API validates params, query and body with `ZodValidationPipe`. Unknown keys are **stripped** (`.strip()`); for critical endpoints (payments, auth) they are **rejected** (`.strict()`).
- Response schemas are used to serialize, which guarantees no extra fields (e.g. `passwordHash`) leak.
- OpenAPI is generated from the Zod schemas. The generator is chosen in Phase 2, when the first business endpoints exist. `nestjs-zod` does not support NestJS 12, so the candidates are `@nestjs/swagger` 12 fed by Zod 4's native `z.toJSONSchema()` (see ADR-015).
- **Implemented (Phase 1):** `ZodValidationPipe` (`apps/api/src/core/http/zod-validation.pipe.ts`), the response envelope interceptor, the global exception filter and the error envelope schema (`packages/validation/src/envelope.ts`).
- Frontends import the same schemas for React Hook Form and for typing TanStack Query results.

## 5. Response format

**Success:**
```json
{ "data": { ... } }
{ "data": [ ... ], "meta": { "nextCursor": "…", "hasMore": true } }
```

**Error:**
```json
{
  "error": {
    "code": "APPOINTMENT_CONFLICT",
    "message": "The selected time overlaps an existing appointment.",
    "details": [{ "path": ["startsAt"], "message": "..." }],
    "requestId": "01JC…"
  }
}
```

| HTTP | When | Example codes |
|---|---|---|
| 400 | Malformed request | `BAD_REQUEST` |
| 401 | No or invalid session | `UNAUTHENTICATED`, `MFA_REQUIRED` |
| 403 | Authenticated but lacks permission (own tenant) | `FORBIDDEN` |
| 404 | Not found **or belongs to another tenant** | `NOT_FOUND` |
| 409 | State conflict, optimistic lock, double booking | `CONFLICT`, `VERSION_CONFLICT`, `APPOINTMENT_CONFLICT` |
| 422 | Validation or business-rule failure | `VALIDATION_FAILED`, `QUOTATION_EXPIRED`, `AMOUNT_EXCEEDS_BALANCE` |
| 429 | Rate limited | `RATE_LIMITED` |
| 500 | Unexpected | `INTERNAL_ERROR` (no internals exposed) |

- Domain errors extend `DomainError(code, httpStatus)`.
- The global filter maps domain errors, Zod errors and known Prisma errors (`P2002` → 409, `P2025` → 404) plus Postgres `23P01` → 409.
- Unknown errors are logged with the stack trace and returned as a generic 500.

## 6. Pagination, filtering and sorting

- **Pagination:** cursor-based. `?limit=25&cursor=…`, max limit 100. The cursor is an opaque base64 of `(sortKey, id)`.
- **Filtering:** explicit, allow-listed query params per endpoint (`?status=ACTIVE&from=2026-11-01`). Generic filter DSLs are not allowed.
- **Sorting:** `?sort=createdAt:desc`, allow-listed fields.
- **Search:** `?q=` uses trigram search where supported.

## 7. Concurrency and idempotency

- Concurrently edited resources return `version`. Updates send `version` and get `409 VERSION_CONFLICT` on mismatch.
- `Idempotency-Key` header is supported on `POST` for payments, order creation, quotation conversion and public bookings. Keys are stored for 24 h per (tenant, key) along with the response.

## 8. Security headers and limits

- Body size limit: 1 MB JSON (uploads go to presigned URLs, not through the API).
- Rate limits per realm (see `AUTHENTICATION_AND_AUTHORIZATION.md` §5).
- Every response carries an `X-Request-Id` header.

## 9. Logging

- One structured log line per request: requestId, realm, tenantId, userId, method, route **template** (not the raw URL with PII), status, duration.
- PII redaction list: `password`, `token`, `authorization`, `cookie`, `email` (hashed), `phone`, measurement values.

## 10. Testing expectations per endpoint

- Unit tests for service business rules.
- Integration tests (Supertest + real Postgres in Docker) for each controller covering the happy path, validation failure, permission denial, and cross-tenant 404.
- Contract tests: response bodies parse with the response schema.
