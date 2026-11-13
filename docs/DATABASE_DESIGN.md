# Database Design — TAHI.ph

> **Status:** Approved (Phase 0). **Implemented:** the Phase 2 identity and tenancy slice (`packages/database/prisma/schema.prisma`, migration `0002_identity_tenancy`), with refinements recorded in ADR-019. Everything else is planned.

## 1. Conventions

| Topic | Convention |
|---|---|
| Engine | PostgreSQL. Major version pinned in Phase 1 after a Prisma compatibility check. |
| ORM | Prisma; raw SQL migrations for RLS, exclusion constraints and partial indexes |
| Naming | Prisma models in `PascalCase` and fields in `camelCase`, mapped to `snake_case` tables/columns via `@@map`/`@map` |
| Primary keys | `id UUID` (UUIDv7: time-ordered, index-friendly, non-enumerable). Generated in the app (`@default(uuid(7))`) or by `uuidv7()` on PG 18. |
| Tenant key | `tenant_id UUID NOT NULL` on every tenant-owned table, plus `UNIQUE (tenant_id, id)` |
| Human numbers | `QUO-2026-0007`, `ORD-2026-0042`, `RCPT-2026-0101`, from `TenantCounter` with `SELECT … FOR UPDATE` inside the creating transaction. Never derived from `MAX()+1`. |
| Timestamps | `timestamptz`, stored UTC. `created_at`, `updated_at` on all tables. Tenant timezone in `TenantSettings.timezone` (default `Asia/Manila`). |
| Dates without time | `date` (e.g. holiday, promised delivery date), interpreted in the tenant's timezone |
| Money | `numeric(12,2)` + `currency char(3)` (default `PHP`). Never float. Arithmetic uses `Prisma.Decimal` / decimal.js in `packages/utils/money`. |
| Measurements | `numeric(7,3)` + unit (`CM`/`IN`) on the record. Three decimals keep 1/8" fractions exact (Q2). |
| Emails | `citext` |
| Enums | Postgres enums for stable sets (statuses); lookup tables for tenant-configurable sets (appointment types, production stages) |
| Soft delete | `archived_at timestamptz NULL` on business entities. Financial and audit tables are never deleted. |
| Optimistic locking | `version int` on entities edited concurrently (Order, Quotation, ProductionJob) |
| JSON | `jsonb` only for snapshots and genuinely schemaless config (e.g. storefront sections), each with a Zod schema |

## 2. Domains

### 2.1 Platform & identity (not tenant-scoped)

| Entity | Purpose | Key fields / notes |
|---|---|---|
| `PlatformUser` | TAHI admins | email (citext, unique), passwordHash, role (`SUPER_ADMIN`/`PLATFORM_ADMIN`), mfaSecret (encrypted), status |
| `PlatformRolePermission` | Scoped platform permissions | role/user → permission |
| `User` | Tenant staff identity (global, one per person) | email unique, passwordHash, emailVerifiedAt, status |
| `Session` | Opaque sessions for all realms | tokenHash (unique), realm, subjectId, activeMembershipId?, tenantId? (customer), ip, userAgent, createdAt, lastSeenAt, expiresAt, revokedAt |
| `AuthToken` | Email verification, password reset, invites, customer OTP | tokenHash, purpose, subjectId, expiresAt, usedAt |
| `Tenant` | A business | slug (unique), name, status, createdAt |
| `TenantDomain` | Hostnames | hostname (unique), tenantId, type (`SUBDOMAIN`/`CUSTOM`), verifiedAt, isPrimary |
| `TenantMembership` | User ↔ Tenant | tenantId, userId, roleId, status (`INVITED`/`ACTIVE`/`DISABLED`), `UNIQUE(tenant_id,user_id)` |
| `Role` | Tenant roles | tenantId, key, name, isSystem. `UNIQUE(tenant_id,key)` |
| `RolePermission` | Role → permission string | (roleId, permission) PK |
| `SubscriptionPlan` | Plan catalogue | code, name, monthlyPrice, annualPrice, currency, trialDays, isActive |
| `PlanFeature` | Limits/flags per plan | planId, key (`staff_seats`, `storage_gb`, `custom_domain`, `online_payments`), value |
| `Subscription` | Tenant's subscription | tenantId (unique while active), planId, interval, status (`TRIALING`/`ACTIVE`/`PAST_DUE`/`CANCELLED`/`EXPIRED`), currentPeriodStart/End, trialEndsAt, cancelAt |
| `SubscriptionInvoice` | TAHI → tenant invoice | subscriptionId, number, amount, tax, status (`DRAFT`/`OPEN`/`PAID`/`VOID`/`UNCOLLECTIBLE`), dueAt, paidAt, line items snapshot |
| `PlatformTransaction` | TAHI ledger | type (`SUBSCRIPTION_PAYMENT`/`REFUND`), amount, provider, providerRef (unique), invoiceId, status. **Subscription revenue only**; never references tenant customer payments |
| `WebhookEvent` | Inbound provider events | provider, eventId, `UNIQUE(provider,event_id)`, accountScope (`PLATFORM`/`TENANT`), tenantId?, payload, receivedAt, processedAt, status |
| `AuditLog` | Platform audit | actorType, actorId, action, targetType, targetId, tenantId?, ip, metadata, createdAt (append-only) |
| `PlatformSetting`, `Announcement`, `SupportTicket` | Phase 7 | — |

### 2.2 Tenant business (all tenant-scoped, RLS)

**Business setup**
- `BusinessProfile`: legal and display name, TIN, address, contact, logo
- `TenantSettings`: timezone, currency, default measurement unit, tax config (rate, inclusive/exclusive, VAT-registered flag), booking rules (lead time, buffer, max days ahead)
- `OperatingHours`: dayOfWeek, opens, closes (multiple rows per day)
- `Holiday`: date, name

**Implemented (Phase 3, migration `0006_tenant_settings`, ADR-024):** the four tables above. Deviations: the logo waits for uploads; booking rules move to the appointments step; opening hours are stored as minutes since local midnight (`opens_minute`, `closes_minute`, CHECK `0 ≤ opens < closes ≤ 1440`); the tax rate is `numeric(5,2)` (0–100); currency is stored but not editable.

**CRM**
- `Client`: names, email, phone, birthday?, address, preferences (jsonb), source, tags, archivedAt
- `CustomerAccount`: per-tenant customer login. `UNIQUE(tenant_id, email)`, `clientId` (1:1 link to a CRM client).
- `ClientNote`: internal notes, author
- `Communication`: channel, direction, summary, at
- `Attachment`: polymorphic on (ownerType, ownerId), object key, mime, size, visibility (`PRIVATE`/`PUBLIC`)
- `DesignReference`: clientId, orderItemId?, image/attachment, notes

**Implemented (Phase 3, migration `0007_clients`, ADR-026):** `Client`, `ClientNote` (author is a membership) and `Communication` (direction `INBOUND`/`OUTBOUND`, recorded by a membership). Preferences are free text, not jsonb. The `CustomerAccount.clientId` link waits for Phase 5; attachments and design references wait for uploads.

**Measurements**
- `GarmentCategory`: tenant-defined (Bridal Gown, Barong Tagalog, Men's Suit…), seeded from platform defaults
- `MeasurementTemplate`: categoryId, version, isCurrent. Templates are **versioned**: editing fields creates a new version.
- `MeasurementField`: templateId, key, label, unitKind, sortOrder, required, min/max
- `MeasurementRecord`: clientId, templateId (version), unit, takenAt, takenBy, notes, `supersedesId?`. **Immutable** once saved (corrections create a new record).
- `MeasurementValue`: recordId, fieldKey, value `numeric(7,3)`

**Implemented (Phase 3, migration `0008_measurements`, ADR-027):** as above, with these changes: no `isCurrent` (the highest version is current); fields have an optional `section` and no `unitKind`/min/max; records have `measuredFor`; templates, fields, records and values are immutable by trigger.

**Appointments**
- `AppointmentType`: name, kind (`CONSULTATION`/`MEASUREMENT`/`DESIGN`/`FITTING`/`FINAL_FITTING`/`PICKUP`/`OTHER`), durationMin, bufferMin, publicBookable, color
- `StaffAvailability`: membershipId, weekly rules + exceptions
- `Appointment`: clientId, typeId, staffMembershipId, startsAt, endsAt, status (`PENDING`/`CONFIRMED`/`COMPLETED`/`CANCELLED`/`NO_SHOW`), source (`DASHBOARD`/`STOREFRONT`), orderId?, rescheduledFromId?

**Implemented (Phase 3, migration `0009_appointments`, ADR-028):** `AppointmentType`, `StaffAvailability` (weekly ranges), `StaffTimeOff` (exceptions) and `Appointment` with `blockedUntil` (end + buffer) and `cancelReason`. Not built: `orderId` (Phase 4) and `rescheduledFromId` (rescheduling moves in place).

**Catalogue**
- `Category`
- `Product`: fixed price, ready-to-wear or made-to-measure
- `Service`: pricingMode (`FIXED`/`QUOTE`), basePrice?
- `OptionGroup` / `Option`: fabric, material, customization, with price deltas
- `MediaAsset`: images with focal point and alt text

**Implemented (Phase 3, migration `0011_catalog`, ADR-030):** `CatalogCategory`, `CatalogItem` (one table for products and services), `CatalogOptionGroup`, `CatalogOption` (price delta, may be negative) and `CatalogItemOptionGroup` (shared groups, ordered). `MediaAsset` came with uploads (below).

**Implemented (Phase 3, migration `0012_media_assets`, ADR-031):** `MediaAsset` (purpose `LOGO` or `CATALOG_ITEM_IMAGE`, status `PENDING` → `PROCESSING` → `READY`/`REJECTED`, uploader membership, rendition width/height). Object keys derive from tenant and id, so none are stored. CHECK: a catalogue image has a `catalog_item_id`, a logo has none. Focal point and alt text are not implemented yet.

**Sales**
- `Quotation`: number, clientId, status (`DRAFT`/`SENT`/`ACCEPTED`/`REJECTED`/`EXPIRED`/`CONVERTED`), validUntil, subtotal, discount, tax, total, revision, `supersedesId?`
- `QuotationItem`: snapshot of name, description, unitPrice, qty, selected options (jsonb), measurementRecordId?
- `Order`: number, clientId, quotationId?, status, promisedDate, subtotal/discount/tax/total, `version`
- `OrderItem`: snapshot fields (as for QuotationItem), `measurementRecordId` **plus** `measurementSnapshot jsonb` (frozen field labels, values and unit), designReferenceIds
- `OrderStatusHistory`: from → to, by, at, note

**Production**
- `ProductionWorkflow`: tenant may have several (e.g. "Bridal", "Alteration only"). One is the default.
- `ProductionStage`: workflowId, name, sortOrder, kind (`NORMAL`/`FITTING`/`QC`/`TERMINAL`)
- `ProductionJob`: orderItemId (1:1), workflowId, currentStageId, status, dueDate
- `StageHistory`: jobId, stageId, enteredAt, exitedAt, by
- `WorkAssignment`: jobId, membershipId, stageId?, role, assignedAt, completedAt
- `Fitting`: jobId, appointmentId?, outcome, notes, photos
- `Alteration`: jobId, fittingId?, description, status, requestedBy (`CLIENT`/`INTERNAL`)

**Payments (tenant ledger)**
- `OrderPayment`: orderId, kind (`DOWN_PAYMENT`/`PARTIAL`/`INSTALLMENT`/`FINAL`), amount, method (`CASH`/`GCASH`/`MAYA`/`BANK_TRANSFER`/`CARD`/`ONLINE`), status (`PENDING`/`SUCCEEDED`/`FAILED`), receivedAt, recordedBy, proofAttachmentId?, receiptNumber, `paymentTransactionId?`
- `PaymentTransaction`: provider-side record for online payments. provider, providerPaymentId (unique), checkoutId, amount, providerFee (PayMongo's processing fee, borne by the tenant), net, status, raw.
- `Refund`: orderPaymentId, amount, reason, status, providerRefundId?
- `InstallmentPlan` / `InstallmentDue`: optional schedule (S priority)
- `TenantMerchantAccount`: provider, mode (`PLATFORM_CHILD`/`OWN_KEYS`), providerAccountId, encryptedCredentials?, status, capabilities (jsonb)

**Storefront & misc**
- `StorefrontConfig`: theme tokens (colors, fonts), sections (jsonb, Zod-validated), SEO defaults, socials, publishedAt
- `PortfolioItem`, `Collection`, `Testimonial`
- `Inquiry`: storefront form submission. type (`GENERAL`/`QUOTE_REQUEST`), status, convertedClientId?
- `Notification`: in-app notification. recipientMembershipId, type, payload, readAt.
- `TenantAuditLog`: append-only
- `TenantCounter`: (tenantId, key, year) → lastValue

## 3. Critical constraints

### 3.1 Double-booking prevention (raw SQL migration)
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointment ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    staff_membership_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('PENDING','CONFIRMED'));
```
- Half-open ranges allow back-to-back slots.
- Buffers use a separate `blocked_until` column (implemented, ADR-028); the constraint ranges over `[starts_at, blocked_until)`.
- The API maps SQLSTATE `23P01` to `409 APPOINTMENT_CONFLICT`.
- Application-level slot computation is for UX only. The constraint is the source of truth.
- Q1 answered: per staff member, so the constraint keeps `staff_membership_id`. "Any available staff" is resolved to a concrete staff member at booking time, inside the same transaction.

### 3.2 Order totals and balances
- `Order.total` is computed from items at write time inside a transaction.
- The balance is a **view or derived query**: `total − Σ succeeded payments + Σ succeeded refunds`. It is never a stored mutable counter. A cached column is allowed later only if recalculated by trigger.

### 3.3 Quotation → order conversion
A single transaction:
1. Lock the quotation (`FOR UPDATE`).
2. Assert `ACCEPTED` and not expired.
3. Allocate the order number.
4. Copy the item snapshots.
5. Set the quotation to `CONVERTED` with `orderId`.

`UNIQUE(quotation_id)` on `order` makes the conversion idempotent.

### 3.4 Webhook idempotency
`UNIQUE(provider, event_id)` on `webhook_event`. `INSERT … ON CONFLICT DO NOTHING`, then process only if inserted.

## 4. Indexing plan (initial)

| Table | Index |
|---|---|
| all tenant tables | `(tenant_id, id)` unique; `(tenant_id, created_at desc)` where listed |
| client | `(tenant_id, last_name, first_name)`; trigram GIN on name/email/phone for search; partial unique `(tenant_id, email) WHERE archived_at IS NULL` |
| appointment | gist exclusion (above); `(tenant_id, starts_at)`; `(tenant_id, client_id, starts_at desc)` |
| order | `(tenant_id, status, promised_date)`; `(tenant_id, client_id, created_at desc)`; unique `(tenant_id, number)` |
| order_payment | `(tenant_id, order_id)`; `(tenant_id, received_at)` for reports |
| production_job | `(tenant_id, current_stage_id)`; `(tenant_id, due_date)` |
| measurement_record | `(tenant_id, client_id, taken_at desc)` |
| session | `token_hash` unique; `(subject_id, revoked_at)` |
| tenant_domain | `hostname` unique |

## 5. Deletion, archival and retention

| Data | Policy |
|---|---|
| Clients, products, services | Soft archive; hidden from lists; restorable |
| Orders, quotations | Never deleted; cancel/void statuses |
| Payments, refunds, transactions, invoices, audit logs | Never deleted or updated except status transitions; append-only audit |
| Measurement records | Never updated; new revisions only |
| Sessions, auth tokens | Purged 30 days after expiry |
| Webhook payloads | Retained 1 year, then payload nulled (keep id/status) |
| Data-subject erasure request (DPA) | Anonymize client PII (name, contact, photos) while keeping financial rows with a pseudonymous reference. The legal retention period for financial records (BIR: 5–10 years) overrides erasure for those fields. Legal review is required. **Implemented (migration `0013_client_privacy`, ADR-032):** client row anonymized (`erased_at`), notes, communications and measurements deleted, appointment text cleared. |
| Cancelled tenants | Export available for 90 days, then anonymize/purge per Terms |

## 6. Multi-currency readiness

Every monetary column has a sibling `currency`. Orders and quotations are single-currency (item currency = order currency). Reports aggregate per currency. FX conversion is out of scope.

## 7. Decisions pending review

1. ~~Q1: appointment resource model~~: per staff member (answered 2026-11-11)
2. ~~Q2: measurement units and precision~~: per-tenant unit, `numeric(7,3)` (answered 2026-11-11)
3. Whether `CustomerAccount` is required for booking, or guest booking with email verification is allowed (recommendation: guest booking allowed; account optional)
4. ~~Installment plans in MVP or later~~: later; Phase 4 records the payment kind only (decided 2026-11-13)
5. ~~Production: one `ProductionJob` per order item (recommended) vs per order~~: per order item (decided 2026-11-13)
