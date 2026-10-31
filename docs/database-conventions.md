# Database conventions

Tables are in `docs/schema.md`. Security rules are in `docs/security.md`. Snippets here are illustrative; no Prisma schema exists yet.

## Prisma version and connections

- **Pin `prisma` and `@prisma/client` to exactly `7.10.1`.** On 2026-10-31, npm's `latest` tag for `prisma` points to a release candidate (`8.0.0-rc.29`), so never install without a version.
- In Prisma 7, `url` and `directUrl` no longer belong in `schema.prisma`. The CLI reads its connection from `prisma.config.ts`, and the client gets its connection through a driver adapter (`@prisma/adapter-pg`).

| Purpose | Role | Connection |
|---|---|---|
| Runtime queries | `tahi_api` | Supavisor **transaction** mode, port 6543 |
| `prisma migrate deploy` | `tahi_migrator` | Supavisor **session** mode, port 5432, or direct |

Migrate doesn't work through transaction-mode pooling. Pooler usernames take the form `role.project-ref`.

Tested on 2026-10-31 through local Supavisor in transaction mode: `adapter-pg` needs no `?pgbouncer=true`, including under concurrent queries and interactive transactions. Local pooler usernames take the form `tahi_api.pooler-dev`.

## Naming

| Thing | Prisma | Database |
|---|---|---|
| Model | `WeddingProject` | `wedding_projects` via `@@map` |
| Field | `tenantId` | `tenant_id` via `@map` |
| Enum | `GarmentStage` | `garment_stage` via `@@map` |
| Enum value | `fabric_sourcing` | `fabric_sourcing` |
| Money | `priceCentavos` | `price_centavos` |
| Date only | `weddingDate`, `takenOn` | `wedding_date`, `taken_on` |
| Timestamp | `startsAt`, `paidAt` | `starts_at`, `paid_at` |
| Index | Let Prisma name it unless too long | |

## Primary keys

`id String @id @default(uuid(7)) @db.Uuid`. Exceptions: `users.id` (equals the Auth `sub`), and tables with natural composite keys listed in `docs/schema.md`.

## Tenant-aware relationships

Every tenant-owned model repeats this pattern:

```prisma
model WeddingProject {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  clientId String @map("client_id") @db.Uuid

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  client Client @relation(fields: [tenantId, clientId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, id])
  @@index([tenantId, clientId])
  @@map("wedding_projects")
}
```

The composite foreign key makes it **impossible at the database level** for a project to point at another tenant's client, whatever the code does.

Rules:

- Target models declare `@@unique([tenantId, id])`.
- `onDelete: Restrict` on every relation. Never `SetNull` on a composite relation.
- Optional relations (`scheduleItemId`) combine a required `tenantId` with a nullable foreign key. Postgres skips the check when any part is null, which is the intended behaviour. Prisma 7.10.1 accepts this shape. Test that a mismatched tenant fails when the first such table is added in Phase 1.
- Set relations with the scalar field (`clientId`). The scoped client refuses nested `connect`.

## Indexing

- Start tenant indexes with `tenant_id`: `(tenant_id, status)`, not `(status)`.
- Index every foreign key and every sort or filter the API exposes.
- A few global lookups are exceptions, such as `tenant_memberships(user_id)`.
- Add indexes for real queries, not speculatively.

## Things Prisma can't express

These go in migration SQL through `prisma migrate dev --create-only`:

- `ENABLE ROW LEVEL SECURITY` on each new table. Forgetting it fails the RLS audit test.
- `CHECK` constraints.
- Partial unique indexes.

## Migrations

| Environment | Command | Notes |
|---|---|---|
| Local | `prisma migrate dev` | Local Postgres only |
| Staging, production | `prisma migrate deploy` | Only from CI or the deploy step |

- **Never** run `migrate dev`, `migrate reset` or `db push` against a shared database.
- Commit migrations, and don't edit one that has been applied.
- Use expand → migrate data → contract for risky changes. Don't drop or rename in the same release as the code that stops using the column.
- Every new table's migration includes RLS enablement.
- Migration order and credentials are in `docs/development.md`.

## Money

- Integer centavos in `Int` columns, suffixed `_centavos`, in the database and API. ₱1,500.50 is `150050`.
- No floats anywhere in calculating money. Convert to pesos only for display.
- `Int` allows about ₱21.4M per value, which is enough for a single amount here. **Report totals can exceed it**, so sums must use `bigint` in SQL and be checked at the boundary. Check how Prisma returns these sums when reports are built in Phase 1.
- Amounts are positive, and direction comes from `kind`.
- Balances are always derived from payments.
- Percentages (such as a deposit rate) are integer basis points, if ever needed.

## Dates and times

| Kind | Column | Example |
|---|---|---|
| A moment | `timestamptz`, stored UTC | `starts_at`, `paid_at` |
| A calendar day | `date` | `wedding_date`, `due_date`, `incurred_on` |

- A calendar day must never be a UTC timestamp, because a Manila date can shift by a day.
- Display in Asia/Manila. Month, day and "today" boundaries in reports are computed in Asia/Manila, not server time.

## Quantities

- Measurements: `numeric(6,2)` with the unit as entered. They arrive in the API as strings, to preserve precision. Inches and centimetres aren't converted on save, so what the designer typed is what they see.
- Avoid JavaScript arithmetic on these without a decimal helper.

## Deletion

| Data | Approach |
|---|---|
| Clients, projects, profiles | `archived_at` |
| Expenses | `deleted_at` |
| Payments, stage events, measurement records | Never removed. Payments are voided; a measurement correction is a new record |
| Audit logs | Never removed in normal operation |

Privacy erasure is a separate, deliberate process (`docs/security.md` §10).

Every query for active records must filter these fields explicitly. The tenant extension doesn't.
