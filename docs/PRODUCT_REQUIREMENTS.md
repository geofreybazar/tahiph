# Product Requirements Document — TAHI.ph

> **Status:** Proposed (Phase 0). Nothing in this document is implemented yet.
> **Last updated:** 2026-11-11

## 1. Vision

TAHI.ph ("tahi" — Filipino for *stitch / sew*) is a multi-tenant SaaS platform that gives independent fashion designers, bespoke tailors, bridal ateliers and alteration shops one place to run their business: clients, measurements, appointments, quotations, orders, production, payments, and a branded public website.

**Problem.** Small ateliers in the Philippines typically run on Facebook Messenger, paper measurement cards, spreadsheets, GCash screenshots and a separate website builder (if any). Measurements get lost or overwritten, fittings are double-booked, and balances are tracked by memory.

**Outcome.** A single system of record per atelier, with a professional storefront that converts visitors into booked consultations.

## 2. Business model

- Subscription SaaS. Each registered business is a **tenant**.
- Plans differ by staff seats, storage, modules and custom domain.
- **TAHI's only revenue is tenant subscriptions.** TAHI takes no commission or fee on tenants' sales. Customer payments belong entirely to the tenant.
- The TAHI platform owner operates all tenants from a Super Admin interface.

## 3. Interfaces

| Interface | Host | Audience | Auth realm |
|---|---|---|---|
| Platform Administration | `admin.tahi.ph` | TAHI staff | Platform |
| Atelier Dashboard | `app.tahi.ph` | Tenant owners and staff | Tenant staff |
| Public Storefront | `{slug}.tahi.ph`, custom domains | Public, tenant customers | Customer (optional) |

## 4. User roles

| Role | Realm | Summary of capabilities |
|---|---|---|
| Super Admin | Platform | Everything, including managing platform admins and global config. MFA mandatory. |
| Platform Administrator | Platform | Scoped permissions (support, billing, tenant ops). Access to tenant business data is permission-gated and audited. |
| Tenant Owner | Tenant | Full control of the tenant, billing/subscription, merchant account, roles. Exactly one owner (transferable). |
| Tenant Administrator | Tenant | Everything except subscription, ownership transfer and merchant-account settings. |
| Designer | Tenant | Clients, measurements, design references, quotations, orders, production oversight. |
| Tailor | Tenant | Assigned production jobs, fittings, alterations; read-only access to relevant measurements. |
| Staff | Tenant | Front desk: appointments, client intake, payment recording (configurable). |
| Customer | Customer (per tenant) | Book appointments, request quotations, track orders, pay online, view their measurements (optional). |

Tenant roles are **defaults**: owners can create custom roles from the permission catalogue (see `AUTHENTICATION_AND_AUTHORIZATION.md`).

## 5. Core business workflow

```
Inquiry ─► Consultation ─► Measurement ─► Quotation ─► Order Confirmation (down payment)
   ─► Fabric Preparation ─► Cutting ─► Sewing ─► Fitting ⇄ Alteration ─► Quality Control
   ─► Completed ─► Released (final payment, pickup/delivery)
```

- Pre-order stages (Inquiry → Quotation) live in CRM / Appointments / Quotations.
- Post-order stages are **tenant-configurable production stages** (`ProductionStage`).
- Fittings and alterations may loop several times.
- Payments can occur at any point (down payment at confirmation is typical, 50% is common).

## 6. Functional requirements by module

Priority: **M** = MVP (first sellable release), **S** = soon after, **L** = later. MVP scope is a proposal pending Q3.

### 6.1 Platform administration
| Feature | Pri |
|---|---|
| Tenant list, status, manual registration, approval, activate/suspend | M |
| Subscription plans (monthly/annual price, trial length, limits) | M |
| Subscriptions: trials, renewals, upgrades/downgrades, cancellation, billing history | M |
| Platform dashboard: tenant counts, trials, MRR/ARR | S |
| Platform revenue, failed payments, refunds, reconciliation | S |
| Platform configuration: email, notifications, feature flags, announcements | S |
| Support tickets | L |
| Audit logs, security events, system health | M (audit) / S (health UI) |

### 6.2 Atelier dashboard
| Module | Key features | Pri |
|---|---|---|
| Business dashboard | KPIs: clients, upcoming appointments, active orders, pending quotations, in production, outstanding balances, revenue | M |
| Clients (CRM) | Profiles, contacts, preferences, notes, attachments, design references, order history, communication log | M |
| Measurements | Configurable templates per garment category, immutable revision history, order snapshots | M |
| Appointments | Calendar, types, operating hours, holidays, slots, booking, reschedule, cancel, reminders | M |
| Products & Services | Catalogue, categories, fixed vs quotation-based pricing, options (fabric, material, customization), gallery | M |
| Quotations | Line items, options, discounts, tax, expiry, send, accept/reject, convert to order | M |
| Orders | Items, statuses, delivery date, timeline, measurement and design references, snapshots | M |
| Production | Configurable stages, assignments, fittings, alterations, QC, history | M |
| Payments | Manual recording (cash, GCash, Maya, bank transfer) with proof, down/partial/installment, balances, receipts, refunds | M |
| Online payments | PayMongo Platforms child account, checkout links, webhooks | S |
| Website management | Branding, sections, portfolio, testimonials, SEO, contact, socials | M |
| Custom domain | Domain verification, TLS | L |
| Staff & access | Invitations, roles, custom roles, activity log | M |
| Reports | Revenue, sales, acquisition, orders, appointments, outstanding, production and staff performance | S |

### 6.3 Public storefront
| Feature | Pri |
|---|---|
| Tenant resolution by subdomain | M |
| Home/hero, about, services, collections, portfolio/gallery, testimonials, contact, socials | M |
| Inquiry form, quotation request | M |
| Appointment booking (public slots) | M |
| Customer order tracking (passwordless) | S |
| Online payment of balances | S |
| SEO: metadata, sitemap, OpenGraph, structured data | M |
| Custom domains | L |

## 7. Key business rules

1. **Tenant isolation.** No user may read or modify another tenant's data. See `MULTI_TENANCY.md`.
2. **Measurement immutability.** Updating a client's measurements creates a new `MeasurementRecord`. Order items keep a reference **and** a frozen snapshot.
3. **Price snapshots.** Order and quotation items copy name, unit price, options and tax at time of creation. Later catalogue changes do not alter them.
4. **Approved quotations are read-only.** Changes require a new revision.
5. **No double-booking** of the same staff member (or atelier, depending on Q1) for overlapping time.
6. **Money** uses decimal types and an explicit currency (default PHP).
7. **Balance** = order total − sum(successful payments) + sum(refunds). It is computed, not hand-entered.
8. **Financial and audit records are never hard-deleted.**
9. **SaaS revenue and tenant customer payments are separate ledgers.** See `PAYMENT_ARCHITECTURE.md`.
10. **Timestamps** are stored in UTC and displayed in the tenant's timezone (default `Asia/Manila`).

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | OWASP ASVS L2 as the target; see `SECURITY.md` |
| Privacy | Philippine Data Privacy Act (RA 10173). Body measurements and photos are personal data. |
| Performance | Storefront LCP < 2.5s on 4G; dashboard API p95 < 300ms for list endpoints at 10k clients/tenant |
| Availability | Single VPS initially. Target 99.5% monthly. RPO ≤ 15 min (WAL archiving), RTO ≤ 4 h |
| Accessibility | WCAG 2.2 AA on dashboard and storefront templates |
| Devices | Desktop, tablet, mobile. Dashboard must be usable on a phone at the fitting table. |
| Localization | English UI first; i18n-ready strings (Q5) |

## 9. Compliance considerations (Philippines)

- **Data Privacy Act 2012 (RA 10173).** TAHI is a *personal information processor*; each tenant is a *personal information controller*. This requires:
  - a Data Processing Agreement in the Terms of Service;
  - a privacy notice and consent capture on storefront forms;
  - a data subject access/erasure workflow;
  - breach notification procedures;
  - an appointed DPO.
- **BIR invoicing (RR 7-2024 / EOPT Act).** Receipts generated by TAHI for tenant customers are **acknowledgment receipts**, not BIR-registered sales invoices, unless a tenant integrates its own accredited invoicing. This must be labeled clearly. Legal review is required.
- **VAT.** Tenants may be VAT-registered or non-VAT. Tax configuration is per tenant (rate, inclusive/exclusive).

## 10. Open business questions

| # | Question | Impacts | Default assumption until answered |
|---|---|---|---|
| Q1 | Are appointments booked per staff member, per atelier (single calendar), or per room/capacity? | Appointment schema, exclusion constraint | Per staff member, with an optional "any available staff" mode |
| Q2 | Measurement units: cm, inches, or per tenant? Fractional inches (1/8)? | Measurement storage | Per-tenant default unit. Values stored as `Decimal(7,2)` in the recorded unit, with the unit stored on each record. |
| Q3 | MVP scope and target launch date | Roadmap | MVP = modules marked **M** |
| Q4 | Plan tiers and limits (seats, storage, custom domain, online payments) | `SubscriptionPlan`, `PlanFeature` | Data-driven limits; values TBD |
| Q5 | English only, or English + Filipino? | i18n | English, i18n-ready |
| Q6 | Self-serve tenant sign-up, or admin approval? | Onboarding | Self-serve sign-up → `PENDING_APPROVAL` → admin approves (configurable) |
| Q7 | ~~Does TAHI take a platform fee on online customer payments?~~ | — | **Answered 2026-11-11: No.** Subscriptions are TAHI's only revenue. |
| Q8 | Customer accounts: is a passwordless email OTP acceptable? SMS OTP? | Customer auth | Email OTP / magic link; SMS later |
| Q9 | Do ateliers need multi-branch support (several locations)? | Tenant model | Single location; `Location` entity deferred |
| Q10 | Inventory of fabric/materials (stock levels)? | New module | Out of scope; options only |

## 11. Out of scope (for now)

Native mobile apps, inventory/stock management, payroll, multi-branch, marketplace across tenants, POS hardware, SMS notifications, accounting/BIR e-invoicing integration.
