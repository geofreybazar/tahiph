# Database ERD — TAHI.ph

> **Status:** Proposed (Phase 0). These diagrams describe relationships for review. They are not the final Prisma schema.
> Attribute lists are abbreviated; see `DATABASE_DESIGN.md` for fields and constraints.
> Every entity in diagrams 2–5 carries `tenant_id`. Composite FKs `(tenant_id, x_id)` are implied on every tenant-to-tenant relation.

## 1. Platform, identity and subscriptions

```mermaid
erDiagram
  PLATFORM_USER ||--o{ AUDIT_LOG : "performs"
  USER ||--o{ TENANT_MEMBERSHIP : "has"
  TENANT ||--o{ TENANT_MEMBERSHIP : "has"
  TENANT ||--o{ TENANT_DOMAIN : "served at"
  TENANT ||--o{ ROLE : "defines"
  ROLE ||--o{ ROLE_PERMISSION : "grants"
  ROLE ||--o{ TENANT_MEMBERSHIP : "assigned to"
  USER ||--o{ SESSION : "staff sessions"
  PLATFORM_USER ||--o{ SESSION : "admin sessions"
  SUBSCRIPTION_PLAN ||--o{ PLAN_FEATURE : "limits"
  SUBSCRIPTION_PLAN ||--o{ SUBSCRIPTION : "subscribed"
  TENANT ||--o{ SUBSCRIPTION : "pays for"
  SUBSCRIPTION ||--o{ SUBSCRIPTION_INVOICE : "bills"
  SUBSCRIPTION_INVOICE ||--o{ PLATFORM_TRANSACTION : "settled by"
  TENANT ||--o| TENANT_MERCHANT_ACCOUNT : "receives customer payments via"

  TENANT { uuid id PK  string slug UK  enum status }
  TENANT_DOMAIN { uuid id PK  uuid tenant_id FK  string hostname UK  enum type  timestamptz verified_at }
  USER { uuid id PK  citext email UK  string password_hash }
  PLATFORM_USER { uuid id PK  citext email UK  enum role  bytes mfa_secret_enc }
  TENANT_MEMBERSHIP { uuid id PK  uuid tenant_id FK  uuid user_id FK  uuid role_id FK  enum status }
  ROLE { uuid id PK  uuid tenant_id FK  string key  bool is_system }
  ROLE_PERMISSION { uuid role_id PK  string permission PK }
  SESSION { uuid id PK  string token_hash UK  enum realm  uuid subject_id  uuid active_membership_id  timestamptz expires_at }
  SUBSCRIPTION_PLAN { uuid id PK  string code UK  numeric monthly_price  numeric annual_price }
  PLAN_FEATURE { uuid plan_id FK  string key  string value }
  SUBSCRIPTION { uuid id PK  uuid tenant_id FK  uuid plan_id FK  enum status  timestamptz current_period_end }
  SUBSCRIPTION_INVOICE { uuid id PK  uuid subscription_id FK  string number UK  numeric total  enum status }
  PLATFORM_TRANSACTION { uuid id PK  enum type  numeric amount  string provider_ref UK  uuid invoice_id FK }
  TENANT_MERCHANT_ACCOUNT { uuid id PK  uuid tenant_id FK  enum mode  string provider_account_id  enum status }
  AUDIT_LOG { uuid id PK  string action  uuid tenant_id  jsonb metadata }
```

## 2. CRM and measurements

```mermaid
erDiagram
  CLIENT ||--o| CUSTOMER_ACCOUNT : "may log in as"
  CLIENT ||--o{ CLIENT_NOTE : "has"
  CLIENT ||--o{ COMMUNICATION : "has"
  CLIENT ||--o{ DESIGN_REFERENCE : "has"
  CLIENT ||--o{ MEASUREMENT_RECORD : "measured in"
  GARMENT_CATEGORY ||--o{ MEASUREMENT_TEMPLATE : "versions"
  MEASUREMENT_TEMPLATE ||--o{ MEASUREMENT_FIELD : "defines"
  MEASUREMENT_TEMPLATE ||--o{ MEASUREMENT_RECORD : "structure of"
  MEASUREMENT_RECORD ||--o{ MEASUREMENT_VALUE : "contains"
  MEASUREMENT_RECORD |o--o| MEASUREMENT_RECORD : "supersedes"

  CLIENT { uuid id PK  uuid tenant_id FK  string first_name  string last_name  citext email  timestamptz archived_at }
  CUSTOMER_ACCOUNT { uuid id PK  uuid tenant_id FK  uuid client_id FK  citext email }
  GARMENT_CATEGORY { uuid id PK  uuid tenant_id FK  string name }
  MEASUREMENT_TEMPLATE { uuid id PK  uuid tenant_id FK  uuid category_id FK  int version  bool is_current }
  MEASUREMENT_FIELD { uuid id PK  uuid template_id FK  string key  string label  int sort_order }
  MEASUREMENT_RECORD { uuid id PK  uuid tenant_id FK  uuid client_id FK  uuid template_id FK  enum unit  timestamptz taken_at  uuid supersedes_id }
  MEASUREMENT_VALUE { uuid record_id FK  string field_key  numeric value }
```

## 3. Appointments and catalogue

```mermaid
erDiagram
  APPOINTMENT_TYPE ||--o{ APPOINTMENT : "categorizes"
  CLIENT ||--o{ APPOINTMENT : "books"
  TENANT_MEMBERSHIP ||--o{ APPOINTMENT : "attends (staff)"
  TENANT_MEMBERSHIP ||--o{ STAFF_AVAILABILITY : "works"
  ORDER ||--o{ APPOINTMENT : "related fittings/pickup"
  CATEGORY ||--o{ PRODUCT : "groups"
  CATEGORY ||--o{ SERVICE : "groups"
  PRODUCT ||--o{ OPTION_GROUP : "customizable by"
  SERVICE ||--o{ OPTION_GROUP : "customizable by"
  OPTION_GROUP ||--o{ OPTION : "offers"

  APPOINTMENT { uuid id PK  uuid tenant_id FK  uuid client_id FK  uuid staff_membership_id FK  timestamptz starts_at  timestamptz ends_at  enum status }
  APPOINTMENT_TYPE { uuid id PK  uuid tenant_id FK  enum kind  int duration_min  bool public_bookable }
  SERVICE { uuid id PK  uuid tenant_id FK  enum pricing_mode  numeric base_price }
  PRODUCT { uuid id PK  uuid tenant_id FK  numeric price }
  OPTION { uuid id PK  uuid tenant_id FK  string name  numeric price_delta }
```

## 4. Quotations, orders, production and payments

```mermaid
erDiagram
  CLIENT ||--o{ QUOTATION : "receives"
  QUOTATION ||--|{ QUOTATION_ITEM : "lists"
  QUOTATION |o--o| ORDER : "converts to"
  CLIENT ||--o{ ORDER : "places"
  ORDER ||--|{ ORDER_ITEM : "contains"
  ORDER ||--o{ ORDER_STATUS_HISTORY : "timeline"
  ORDER_ITEM }o--o| MEASUREMENT_RECORD : "references (+ frozen snapshot)"
  ORDER_ITEM ||--o| PRODUCTION_JOB : "produced by"
  PRODUCTION_WORKFLOW ||--|{ PRODUCTION_STAGE : "ordered stages"
  PRODUCTION_WORKFLOW ||--o{ PRODUCTION_JOB : "followed by"
  PRODUCTION_JOB }o--|| PRODUCTION_STAGE : "current stage"
  PRODUCTION_JOB ||--o{ STAGE_HISTORY : "moved through"
  PRODUCTION_JOB ||--o{ WORK_ASSIGNMENT : "assigned to staff"
  PRODUCTION_JOB ||--o{ FITTING : "fitted"
  FITTING ||--o{ ALTERATION : "results in"
  PRODUCTION_JOB ||--o{ ALTERATION : "has"
  ORDER ||--o{ ORDER_PAYMENT : "paid by"
  ORDER_PAYMENT }o--o| PAYMENT_TRANSACTION : "online settlement"
  ORDER_PAYMENT ||--o{ REFUND : "refunded by"

  QUOTATION { uuid id PK  uuid tenant_id FK  string number  enum status  date valid_until  numeric total  int revision }
  QUOTATION_ITEM { uuid id PK  uuid quotation_id FK  string name_snapshot  numeric unit_price  jsonb options_snapshot }
  ORDER { uuid id PK  uuid tenant_id FK  string number  uuid quotation_id UK  enum status  date promised_date  numeric total  int version }
  ORDER_ITEM { uuid id PK  uuid order_id FK  string name_snapshot  numeric unit_price  uuid measurement_record_id FK  jsonb measurement_snapshot }
  PRODUCTION_JOB { uuid id PK  uuid order_item_id UK  uuid current_stage_id FK  date due_date }
  PRODUCTION_STAGE { uuid id PK  uuid workflow_id FK  string name  int sort_order  enum kind }
  ORDER_PAYMENT { uuid id PK  uuid order_id FK  enum kind  enum method  numeric amount  enum status  string receipt_number }
  PAYMENT_TRANSACTION { uuid id PK  string provider  string provider_payment_id UK  numeric amount  numeric fee  enum status }
  REFUND { uuid id PK  uuid order_payment_id FK  numeric amount  enum status }
```

## 5. Storefront, inquiries and system

```mermaid
erDiagram
  TENANT ||--|| STOREFRONT_CONFIG : "website"
  TENANT ||--|| BUSINESS_PROFILE : "identity"
  TENANT ||--|| TENANT_SETTINGS : "configuration"
  TENANT ||--o{ OPERATING_HOURS : "open"
  TENANT ||--o{ HOLIDAY : "closed"
  COLLECTION ||--o{ PORTFOLIO_ITEM : "groups"
  PORTFOLIO_ITEM ||--o{ MEDIA_ASSET : "images"
  TENANT ||--o{ TESTIMONIAL : "shows"
  INQUIRY }o--o| CLIENT : "converted to"
  TENANT_MEMBERSHIP ||--o{ NOTIFICATION : "receives"
  TENANT ||--o{ TENANT_AUDIT_LOG : "records"
  TENANT ||--o{ TENANT_COUNTER : "numbering"

  STOREFRONT_CONFIG { uuid tenant_id PK  jsonb theme  jsonb sections  jsonb seo  timestamptz published_at }
  INQUIRY { uuid id PK  uuid tenant_id FK  enum type  enum status  citext email }
  TENANT_COUNTER { uuid tenant_id PK  string key PK  int year PK  int last_value }
```

## 6. Cardinality notes

| Relationship | Rule |
|---|---|
| User ↔ Tenant | Many-to-many via `TenantMembership`. Exactly one `OWNER` membership per tenant (partial unique index). |
| Client ↔ CustomerAccount | 0..1. A customer account is always for one tenant. |
| Quotation ↔ Order | 0..1. `order.quotation_id` is unique. Orders can be created without a quotation. |
| OrderItem ↔ MeasurementRecord | Many-to-0..1 reference **plus** an immutable JSON snapshot copied at order confirmation |
| OrderItem ↔ ProductionJob | 1 : 0..1 (items such as accessories may not need production) |
| Order ↔ OrderPayment | 1 : many. The balance is derived. |
| OrderPayment ↔ PaymentTransaction | Manual payments have none; online payments have exactly one |
| Tenant ↔ Subscription | 1 : many over time. At most one in a non-terminal state (partial unique). |
| Tenant ↔ TenantMerchantAccount | 1 : 0..1 per provider |
