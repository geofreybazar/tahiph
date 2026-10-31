# Database schema

**Status: approved by the owner on 2026-10-31; not built yet.** This file owns the table list. Conventions are in `docs/database-conventions.md`.

## Conventions used below

Every tenant-owned table has these, which aren't repeated in each table:

- `id` uuid primary key (UUIDv7)
- `tenant_id` uuid not null, foreign key to `tenants(id)`
- `created_at`, `updated_at` timestamptz
- Unique `(tenant_id, id)`, the target for composite foreign keys

A foreign key written `client_id →` on a tenant-owned table means the composite key `(tenant_id, client_id) → clients(tenant_id, id)`, with `ON DELETE RESTRICT`. Global tables are marked **Global**.

## Overview

```text
tenants ─┬─ tenant_memberships ── users ── platform_admins
         ├─ tenant_invitations
         ├─ clients ─┬─ measurement_profiles ── measurement_records ── measurement_values
         │           └─ wedding_projects ─┬─ garments ── garment_stage_events
         │                                ├─ payment_schedule_items
         │                                └─ payments
         ├─ appointments  (client, project and garment all optional)
         ├─ expenses      (project optional)
         ├─ media_files
         └─ document_counters
```

## Decision: project = order

**Confirmed 2026-10-31** (`docs/decisions/0007-project-is-the-order.md`). There is no `orders` table. `wedding_projects` carries the price, order number and payment schedule. Production stages sit on `garments`. The Orders module in the UI and API is a view over projects.

## Global tables

### `tenants` — Global

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| slug | text | Unique, lower case. Subdomain. Validated against the reserved list. Changed only by super-admin; old slugs are not reused |
| name | text | |
| status | enum | `active`, `inactive`, `suspended` |
| created_at, updated_at | timestamptz | |

### `users` — Global

| Field | Type | Notes |
|---|---|---|
| id | uuid | Equals the Supabase Auth `sub`. Not generated here |
| email | text | Unique, kept in sync from the verified token |
| full_name | text | Nullable |
| created_at, updated_at | timestamptz | |

No database foreign key to `auth.users`, because Prisma doesn't manage the `auth` schema and Supabase owns it.

### `platform_admins` — Global

`user_id` (primary key, → `users`), `created_at`. A row here is what makes someone a super-admin.

### `audit_logs` — Global (Approved)

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| tenant_id | uuid | Nullable, for platform-level events |
| actor_user_id | uuid | Nullable, for system jobs |
| action | text | For example `payment.voided` |
| entity_type, entity_id | text, uuid | |
| metadata | jsonb | Never holds measurements or tokens |
| created_at | timestamptz | |

Append-only. Index `(tenant_id, created_at DESC)`. It has a nullable `tenant_id`, so it's a named exception to the tenant registry, written through a dedicated service.

## Tenant-owned tables: Phase 1 (MVP)

### `tenant_memberships`

| Field | Type | Notes |
|---|---|---|
| user_id | uuid | → `users` |
| role | enum | `owner`, `admin`, `staff` |
| status | enum | `active`, `removed` |

Unique `(tenant_id, user_id)`. Index `(user_id)` for "my tenants". One active owner per tenant, enforced by a partial unique index in migration SQL.

### `tenant_invitations`

| Field | Type | Notes |
|---|---|---|
| email | text | Lower case |
| role | enum | `admin`, `staff`; `owner` for the first invite from super-admin |
| token_hash | text | Unique. The raw token is never stored |
| expires_at, accepted_at | timestamptz | |
| invited_by_user_id | uuid | → `users` |

Partial unique `(tenant_id, email)` where `accepted_at IS NULL`.

### `clients`

| Field | Type | Notes |
|---|---|---|
| full_name | text | |
| email, phone | text | Nullable |
| notes | text | Nullable |
| archived_at | timestamptz | Nullable |

Index `(tenant_id, full_name)`, `(tenant_id, email)`. Email isn't unique, because couples and family members sometimes share one.

### `wedding_projects`

| Field | Type | Notes |
|---|---|---|
| client_id | uuid | → `clients`. The paying client |
| project_number | text | From `document_counters`. Unique `(tenant_id, project_number)` |
| title | text | |
| wedding_date | date | Nullable. Date only, no time zone |
| status | enum | `draft`, `active`, `completed`, `cancelled` |
| price_centavos | int | Not null, `CHECK >= 0` |
| notes | text | Nullable |
| archived_at | timestamptz | Nullable |

Index `(tenant_id, client_id)`, `(tenant_id, status)`, `(tenant_id, wedding_date)`.

### `garments`

| Field | Type | Notes |
|---|---|---|
| project_id | uuid | → `wedding_projects` |
| name | text | |
| wearer_name | text | |
| wearer_role | enum | `bride`, `groom`, `entourage`, `other` |
| description | text | Nullable |
| stage | enum | Current stage (below) |
| measurement_record_id | uuid | Nullable, → `measurement_records`. Keeps the exact version assigned |
| due_date | date | Nullable |

Stages: `design`, `fabric_sourcing`, `cutting`, `sewing`, `embellishment`, `fitting`, `alterations`, `ready`, `released`.

Index `(tenant_id, project_id)`, `(tenant_id, stage)`.

### `garment_stage_events`

Append-only history. Stages can go backward (Fitting ↔ Alterations, repeatedly), and every change is recorded, including corrections.

`garment_id` →, `from_stage` (nullable), `to_stage`, `changed_by_user_id`, `note`, `occurred_at`. Index `(tenant_id, garment_id, occurred_at)`.

### `measurement_profiles`

One person's measurements. Entourage members may not be clients themselves, so `person_name` is separate.

`client_id` →, `person_name`, `notes`, `portal_visible` (boolean, default false; Phase 2 use), `archived_at`. Index `(tenant_id, client_id)`.

### `measurement_records`

One fitting's set of measurements. **Never edited after creation**; a correction is a new record.

`profile_id` →, `taken_on` (date), `unit` (`in` or `cm`, as entered), `notes`, `recorded_by_user_id`. Index `(tenant_id, profile_id, taken_on DESC)`.

### `measurement_values`

`record_id` →, `key` (text, from the shared list in `packages/shared`, or a custom key), `label` (nullable; for custom keys), `value` (`numeric(6,2)`, `CHECK > 0`). Unique `(tenant_id, record_id, key)`.

### `appointments`

| Field | Type | Notes |
|---|---|---|
| client_id | uuid | Nullable, → `clients` |
| project_id | uuid | Nullable, → `wedding_projects` |
| garment_id | uuid | Nullable, → `garments` |
| type | enum | `consultation`, `fitting`, `pickup`, `other` |
| status | enum | `scheduled`, `completed`, `cancelled`, `no_show` |
| starts_at, ends_at | timestamptz | UTC. `CHECK (ends_at > starts_at)` |
| location, notes | text | Nullable |

Index `(tenant_id, starts_at)`, `(tenant_id, client_id)`.

### `payment_schedule_items`

The planned payments for a project.

`project_id` →, `label`, `due_date` (date), `amount_centavos` (`CHECK > 0`), `sort_order`. Index `(tenant_id, project_id)`.

Whether scheduled amounts must add up to the project price is an application warning, not a database rule, because prices change during a project.

### `payments`

**Append-only.** Mistakes are voided, not edited or deleted.

| Field | Type | Notes |
|---|---|---|
| project_id | uuid | → `wedding_projects` |
| schedule_item_id | uuid | Nullable, → `payment_schedule_items` |
| kind | enum | `payment`, `refund` |
| amount_centavos | int | `CHECK > 0`. `kind` gives the direction |
| method | enum | `cash`, `gcash`, `maya`, `bank_transfer`, `card`, `other` |
| reference | text | Nullable |
| paid_at | timestamptz | When the money moved |
| proof_media_id | uuid | Nullable, → `media_files` |
| recorded_by_user_id | uuid | → `users` |
| idempotency_key | uuid | Unique `(tenant_id, idempotency_key)`, so a retry can't record money twice (Proposed) |
| voided_at, voided_by_user_id, void_reason | | Nullable. `CHECK` that all three are set together |

Index `(tenant_id, project_id)`, `(tenant_id, paid_at)`.

**Balances are derived, never stored:** `price_centavos − Σ(non-voided payments) + Σ(non-voided refunds)`.

### `expenses`

| Field | Type | Notes |
|---|---|---|
| kind | enum | `operating`, `production` |
| category | text | |
| description | text | Nullable |
| amount_centavos | int | `CHECK > 0` |
| incurred_on | date | |
| project_id | uuid | Nullable, → `wedding_projects` |
| receipt_media_id | uuid | Nullable, → `media_files` |
| recorded_by_user_id | uuid | → `users` |
| deleted_at | timestamptz | Nullable; soft delete |

Index `(tenant_id, incurred_on)`, `(tenant_id, kind, incurred_on)`.

### `media_files`

| Field | Type | Notes |
|---|---|---|
| bucket | enum | `public_media`, `private_media` |
| object_key | text | Unique `(bucket, object_key)`. Starts with `tenant_id/` |
| purpose | enum | For example `sketch`, `fitting_photo`, `payment_proof`, `expense_receipt` |
| mime_type | text | The verified type |
| size_bytes | int | The verified size |
| original_filename | text | Display only; never part of the key |
| status | enum | `pending`, `ready` |
| uploaded_by_user_id | uuid | → `users` |
| expires_at | timestamptz | For cleaning up `pending` rows |

Links from garments to files (`garment_media`: `garment_id` →, `media_file_id` →) use the same composite foreign keys. Unique `(tenant_id, media_file_id)`: a file belongs to one garment, and removing it deletes the file.

### `document_counters`

Per-tenant numbering, safe under concurrent requests through an atomic increment.

Primary key `(tenant_id, key)`, `value` bigint. Key example: `project:2026`. This table has no separate `id`; it's the one exception to the `id` convention.

## Tenant-owned tables: Phase 2 (outline)

Detailed when Phase 2 starts.

| Table | Purpose |
|---|---|
| `client_portal_access` | `user_id` → `users`, `client_id` →, `status`. Unique `(tenant_id, user_id)`, `(tenant_id, client_id)`. See ADR 0009 |
| `site_settings` | Public business info, about text, logo, SEO. One row per tenant |
| `portfolio_items`, `collections`, `packages` | Public content |
| `inquiries` | Public form submissions |
| `notifications` | Client and member notices |

## Phase 3 (outline)

`plans`, `tenant_subscriptions`, `subscription_payments`, `custom_domains`. Not designed yet.

## Foreign key strategy

- Tenant-owned → tenant-owned: always composite, always through `tenant_id`.
- Tenant-owned → `users`: plain foreign key.
- `ON DELETE RESTRICT` throughout. **Never `SET NULL` on a composite foreign key**, because by default it also nulls `tenant_id`, which is not null, so the operation fails.
- Records people depend on are archived, not deleted.
- Tenants aren't hard-deleted through the API.

## Calculated reporting values

MVP definitions, approved by the owner on 2026-10-31:

| Value | Definition |
|---|---|
| Revenue | Non-voided payments minus non-voided refunds, by `paid_at` |
| Expenses | Non-deleted expenses, by `incurred_on` |
| Profit | Revenue − expenses. **Cash basis**; a deposit counts when received, even if the garment is unfinished |
| Receivables | Σ balance of `active` projects |

Months are Asia/Manila calendar months. These reports aren't accounting or tax records.
