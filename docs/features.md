# Features

**MVP** means Phase 0 and Phase 1 in `docs/roadmap.md`: the private atelier workflow. **Later** names the phase. Items marked *Approved* are additions to the original brief, approved by the owner on 2026-10-31.

## MVP scope in one paragraph

A designer's team can manage clients, wedding projects, garments, versioned measurements, production stages, appointments, payment schedules, payments and expenses, and owners and admins can see the business numbers. A super-admin can create and suspend tenants. There are no public websites, client portal or subscription billing in the MVP.

## Accounts and tenants

| Feature | Scope |
|---|---|
| Sign in, sign out, password reset (Supabase Auth) | MVP |
| Create a tenant and invite its owner (by super-admin) | MVP |
| Self-service designer sign-up | Later (Phase 3) |
| Invite members by email | MVP |
| Roles: owner, admin, staff | MVP |
| Remove a member, change a role | MVP |
| Transfer ownership | MVP |
| Belong to several tenants and switch between them | MVP |
| Configurable permission system | Later (not yet scheduled) |

## Dashboard

| Feature | Scope |
|---|---|
| Operational overview: upcoming fittings, garments by stage (all roles) | MVP |
| Financial overview: revenue, profit, receivables (owner, admin) | MVP |

## Clients

| Feature | Scope |
|---|---|
| Client profiles and contact details | MVP |
| Notes | MVP |
| Project and payment history per client | MVP |
| Search | MVP |
| Archive | MVP |
| Import from a spreadsheet | Later (not scheduled) |

## Wedding projects and orders

A project **is** the order: one price, one number, one payment schedule (ADR 0007).

| Feature | Scope |
|---|---|
| Create projects with wedding date and notes | MVP |
| Project number per tenant | MVP |
| Project price and derived balance | MVP |
| Order list and tracking (a view over projects) | MVP |
| Status: draft, active, completed, cancelled | MVP |
| Separate invoices per person within one project | Later (would need a model change) |

## Garments and production

| Feature | Scope |
|---|---|
| Garments for bride, groom, entourage and others | MVP |
| Design details and description | MVP |
| Assign a measurement version | MVP |
| Nine-stage workflow: Design, Fabric Sourcing, Cutting, Sewing, Embellishment, Fitting, Alterations, Ready, Released | MVP |
| Move stages backward, with full history | MVP |
| Production board by stage | MVP |
| Sketches and design references | MVP |
| Assign garments to specific staff | Later |

## Measurements

| Feature | Scope |
|---|---|
| Profiles per person, including people who aren't clients | MVP |
| Immutable history for every fitting | MVP |
| Inches or centimetres, as entered | MVP |
| Compare fittings side by side | Later |
| Client-visible summaries | Later (Phase 2) |

## Appointments

| Feature | Scope |
|---|---|
| Consultations, fittings, pickups | MVP |
| Calendar view | MVP |
| Link to client, project, garment | MVP |
| Complete, cancel, no-show | MVP |
| Double-booking warnings | Later |
| Online consultation booking | Later (Phase 2) |
| Automated reminders | Later (Phase 3) |

## Payments

| Feature | Scope |
|---|---|
| Payment schedule: deposit, milestones, balance | MVP |
| Record payments and refunds | MVP |
| Void with reason, never edit | MVP |
| Upload payment proof | MVP |
| Outstanding balance | MVP |
| Tenant-wide payment history (owner, admin) | MVP |
| Clients pay online | Later (not in brief; PayMongo in Phase 3 is for subscriptions unless changed) |

## Expenses (owner, admin)

| Feature | Scope |
|---|---|
| Operating and production expenses | MVP |
| Link to a project | MVP |
| Categories | MVP |
| Upload receipts | MVP |

## Reports (owner, admin)

| Feature | Scope |
|---|---|
| Sales, revenue, profit, receivables, operational (basic) | MVP |
| Export to CSV | Later |
| Advanced reports | Later (Phase 3) |

Profit is cash basis in the MVP (`docs/schema.md`). These reports aren't tax records.

## Files

| Feature | Scope |
|---|---|
| Private uploads and short-lived download links | MVP |
| Public media uploads | Later (Phase 2) |

## Public designer websites

| Feature | Scope |
|---|---|
| `designer.tahi.ph` by hostname | Later (Phase 2); placeholder in Phase 0 |
| Portfolio, collections, packages, about | Later (Phase 2) |
| Public business information | Later (Phase 2) |
| Inquiry form | Later (Phase 2) |
| Consultation booking | Later (Phase 2) |
| SEO and social link previews | Later (Phase 2) |
| Custom domains and verification | Later (Phase 3) |
| Designer branding and themes | Later (Phase 3) |

## Client portal (in `apps/web`)

All Later (Phase 2).

| Feature | Scope |
|---|---|
| Secure sign-in by invitation | Later (Phase 2) |
| Order status and garment progress | Later (Phase 2) |
| Upcoming fittings and appointments | Later (Phase 2) |
| Measurement summaries, where authorized | Later (Phase 2) |
| Payment history and outstanding balance | Later (Phase 2) |
| Notifications | Later (Phase 2) |

## Super-admin

| Feature | Scope |
|---|---|
| List tenants, create them, invite the owner | MVP (*Approved*; the brief's roadmap doesn't schedule it, but tenants can't be onboarded or suspended without it) |
| Suspend and activate tenants | MVP (*Approved*, same reason) |
| Account management | Later (Phase 3) |
| Subscription plans and status | Later (Phase 3) |
| Usage monitoring and limits | Later (Phase 3) |
| Platform and tenant analytics | Later (Phase 3) |

## Billing

| Feature | Scope |
|---|---|
| Subscriptions and PayMongo | Later (Phase 3) |
