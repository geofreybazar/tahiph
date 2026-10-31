# API conventions and MVP endpoints

**Status: approved by the owner on 2026-10-31.** All paths are under `/api/v1`. None of this is implemented.

## Response format

Success:

```json
{
  "success": true,
  "data": {},
  "timestamp": "2026-10-31T08:00:00.000Z"
}
```

Paginated (the brief's example omitted `timestamp`; it's included here so every response has it):

```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 },
  "timestamp": "2026-10-31T08:00:00.000Z"
}
```

Error:

```json
{
  "success": false,
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  },
  "timestamp": "2026-10-31T08:00:00.000Z",
  "path": "/api/v1/clients"
}
```

## Status codes

| Status | Code | When |
|---|---|---|
| 200 | | Read or update succeeded |
| 201 | | Created |
| 204 | | Success with no body; the envelope is omitted |
| 400 | `VALIDATION_ERROR` | Invalid input. `details` is `[{ "path": "email", "message": "..." }]` |
| 400 | `BAD_REQUEST` | Unreadable request, such as malformed JSON |
| 400 | `TENANT_REQUIRED` | `X-Tenant-Id` missing |
| 401 | `UNAUTHENTICATED` | Token missing, invalid or expired |
| 403 | `FORBIDDEN` | Role not allowed |
| 403 | `TENANT_ACCESS_DENIED` | Not a member, whether or not the tenant exists |
| 403 | `TENANT_SUSPENDED` | Tenant suspended |
| 403 | `MFA_REQUIRED` | Platform route without `aal2` (Approved) |
| 404 | `NOT_FOUND` | Missing, **or another tenant's record** |
| 409 | `CONFLICT` | Duplicate, or a state conflict such as voiding twice |
| 422 | `BUSINESS_RULE_VIOLATION` | Valid input that a business rule refuses |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected. Never includes internals |

## Lists

- **Pagination:** `?page=1&limit=20`. Maximum limit 100.
- **Sorting:** `?sort=-createdAt,fullName`. `-` means descending. Each endpoint has an allowlist; unknown fields return 400.
- **Filtering:** named params per endpoint (`?status=active&clientId=...`). Text search uses `?q=`. Unknown filters return 400.

## Data formats

- JSON fields use camelCase.
- Money is integer centavos with a `Centavos` suffix.
- Moments are ISO 8601 UTC. Calendar days are `YYYY-MM-DD`.
- Measurement values are decimal strings.

## Versioning

URI versioning, `/api/v1`. Additive changes stay in v1. Breaking changes get `/api/v2`.

## Validation and Swagger

- Zod schemas in `packages/shared` validate requests and shape responses. See ADR 0008.
- Swagger is generated from those schemas, available at `/api/docs` outside production.
- Restricted responses have their own schemas, so a staff response can't accidentally contain owner fields.

## Required headers

| Header | Applies to |
|---|---|
| `Authorization: Bearer <access token>` | Everything except `Public` |
| `X-Tenant-Id: <uuid>` | Tenant endpoints. Always validated against membership |
| `Idempotency-Key: <uuid>` | `POST` on payments (Approved), so a retry doesn't record money twice |

## Access key

| Label | Meaning |
|---|---|
| Public | No token |
| User | Any valid token, no tenant |
| O / A / S | Tenant owner / admin / staff |
| Client | Token, plus `client_portal_access` for the tenant in the path |
| Platform | `platform_admins` row, plus MFA (Approved) |

## Phase 0 and identity

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/health` | Liveness and database check | Public |
| GET | `/me` | Current user, memberships and platform flag | User |
| POST | `/invitations/accept` | Accept an invitation by token; verified email must match | User |

## Tenant settings and members

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/tenant` | Current tenant profile | O A S |
| PATCH | `/tenant` | Update profile | O A |
| GET | `/members` | List members | O A |
| PATCH | `/members/:id` | Change role | O (A for staff only) |
| DELETE | `/members/:id` | Remove a member | O (A for staff only) |
| POST | `/members/transfer-ownership` | Transfer ownership | O |
| GET | `/invitations` | Pending invitations | O A |
| POST | `/invitations` | Invite by email. Emails new people; always returns a one-time link for the inviter, because Supabase can't email an existing account | O (A for staff only) |
| DELETE | `/invitations/:id` | Revoke | O A |

## Clients

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/clients` | List, search | O A S |
| POST | `/clients` | Create | O A S |
| GET | `/clients/:id` | Profile | O A S |
| PATCH | `/clients/:id` | Update | O A S |
| POST | `/clients/:id/archive` | Archive | O A |
| GET | `/clients/:id/projects` | Client's projects | O A S |

## Wedding projects and orders

The Orders screens use these endpoints, because project = order.

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/projects` | List with filters. **No tenant-wide totals** | O A S |
| POST | `/projects` | Create, assigns project number | O A S |
| GET | `/projects/:id` | Detail, including price. The derived balance is on `GET /projects/:id/payments` | O A S |
| PATCH | `/projects/:id` | Update details, excluding price | O A S |
| PATCH | `/projects/:id/price` | Change price; audited | O A |
| POST | `/projects/:id/status` | Change status | O A S |
| POST | `/projects/:id/archive` | Archive | O A |

## Garments and production

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/projects/:id/garments` | Garments on a project | O A S |
| POST | `/projects/:id/garments` | Add a garment | O A S |
| GET | `/garments` | Production board, filter by stage | O A S |
| GET | `/garments/:id` | Detail | O A S |
| PATCH | `/garments/:id` | Update, including assigned measurement record | O A S |
| POST | `/garments/:id/stage` | Move stage; writes an event | O A S |
| GET | `/garments/:id/stage-events` | History | O A S |
| DELETE | `/garments/:id` | Remove, refused once work has started or while it has files | O A |
| GET | `/garments/:id/media` | Sketches and design references | O A S |
| POST | `/garments/:id/media` | Attach a confirmed file | O A S |
| DELETE | `/garments/:id/media/:mediaFileId` | Remove from the garment and delete the file | Uploader, O A |

## Measurements

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/clients/:id/measurement-profiles` | Profiles | O A S |
| POST | `/clients/:id/measurement-profiles` | Create | O A S |
| GET | `/measurement-profiles/:id` | Profile with history | O A S |
| PATCH | `/measurement-profiles/:id` | Update name or notes | O A S |
| POST | `/measurement-profiles/:id/records` | Add a fitting's record. Records can't be edited | O A S |
| GET | `/measurement-records/:id` | One record | O A S |

## Appointments

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/appointments` | Calendar, by date range | O A S |
| POST | `/appointments` | Create | O A S |
| GET | `/appointments/:id` | Detail | O A S |
| PATCH | `/appointments/:id` | Update or reschedule | O A S |
| POST | `/appointments/:id/status` | Complete, cancel, no-show | O A S |

## Payments

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/projects/:id/payment-schedule` | Schedule | O A S |
| PUT | `/projects/:id/payment-schedule` | Replace schedule. Items sent with an `id` are kept. The response reports any difference from the price, as a warning | O A |
| GET | `/projects/:id/payments` | One project's payments, with paid, refunded and derived balance | O A S |
| GET | `/clients/:id/payments` | One client's payment history (Proposed) | O A S |
| POST | `/projects/:id/payments` | Record a payment or refund. `Idempotency-Key` is required; a retry returns the first result, and the key used for a different payment is a 409 | O A S (refunds O A) |
| POST | `/payments/:id/void` | Void, with reason; audited | O A |
| GET | `/payments` | **Tenant-wide** list, filter by Manila days with `from` and `to` | O A |

## Expenses

Owner and admin only.

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/expenses` | List, by date range and kind | O A |
| POST | `/expenses` | Create | O A |
| GET | `/expenses/:id` | Detail | O A |
| PATCH | `/expenses/:id` | Update. Replacing or clearing `receiptMediaId` deletes the old file; leaving it out keeps it | O A |
| DELETE | `/expenses/:id` | Soft delete | O A |

## Dashboard and reports

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/dashboard/operations` | Upcoming fittings, garments by stage. No money | O A S |
| GET | `/dashboard/financial` | Revenue, profit, receivables | O A |
| GET | `/reports/sales` | Sales by period | O A |
| GET | `/reports/revenue` | Revenue by period | O A |
| GET | `/reports/profit` | Profit by period | O A |
| GET | `/reports/receivables` | Outstanding balances | O A |
| GET | `/reports/operations` | Production and appointment counts | O A |

## Media

| Method | Path | Purpose | Access |
|---|---|---|---|
| POST | `/media/upload-intents` | Check purpose and role, return a signed upload URL | Depends on purpose: S allowed except expense receipts |
| POST | `/media/:id/confirm` | Verify the stored object | Uploader, O A |
| GET | `/media/:id/download-url` | Short-lived signed URL | Depends on what the file is attached to |
| DELETE | `/media/:id` | Delete if unattached | Uploader, O A |

A file's access follows its parent. For example, an expense receipt is owner/admin only.

## Platform (minimal MVP, Approved)

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/platform/tenants` | List tenants | Platform |
| POST | `/platform/tenants` | Create a tenant and invite its owner | Platform |
| GET | `/platform/tenants/:id` | Detail | Platform |
| POST | `/platform/tenants/:id/suspend` | Suspend; audited | Platform |
| POST | `/platform/tenants/:id/activate` | Activate; audited | Platform |

## Phase 2 (outline)

**Public** (called from the `apps/web` server):

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/public/sites/:slug` | Public tenant profile, for the slug `apps/web` derived from the hostname. Built in Phase 0 | Public |
| GET | `/public/sites/:slug/portfolio`, `/collections`, `/packages` | Public content | Public |
| POST | `/public/sites/:slug/inquiries` | Inquiry form; rate limited | Public |
| POST | `/public/sites/:slug/consultations` | Consultation request; rate limited | Public |

**Portal.** Results are always limited to the client linked by `client_portal_access`; the client can't choose another client ID.

| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/portal/:slug/projects` | Own projects and progress | Client |
| GET | `/portal/:slug/projects/:id` | Garment stages and balance | Client |
| GET | `/portal/:slug/appointments` | Own appointments | Client |
| GET | `/portal/:slug/payments` | Own payment history | Client |
| GET | `/portal/:slug/measurements` | Only `portal_visible` profiles | Client |

Dashboard management of site content and notifications is specified when Phase 2 starts. Phase 3 endpoints aren't designed yet.
