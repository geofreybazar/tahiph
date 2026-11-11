# Authentication & Authorization — TAHI.ph

> **Status:** Phase 2 in progress.
> **Implemented:**
> - sessions (`SessionService`), the global access guard, decorators and the permission catalogue (`packages/types/src/permissions.ts`); see ADR-019;
> - staff register, verify, login, logout, me, switch-tenant, forgot/reset password, onboarding and invitations, plus CSRF and throttling; see ADR-020.
>
> **Planned:** platform admin login with TOTP, customer OTP, optional staff TOTP, the HIBP check and session management.
> **Decision:** opaque server-side sessions (ADR-002). JWTs are not used for browser auth.

## 1. Realms

The three realms are completely separate authentication boundaries: different identity tables, cookie names, hosts and login endpoints. A session from one realm is never accepted by another.

| Realm | Host | Identity | Login method | MFA | Cookie |
|---|---|---|---|---|---|
| Platform | `admin.tahi.ph` | `PlatformUser` | Email + password | **TOTP required** (WebAuthn later) | `__Host-tahi_admin` |
| Tenant staff | `app.tahi.ph` | `User` + `TenantMembership` | Email + password | Optional TOTP; can be enforced per tenant | `__Host-tahi_app` |
| Customer | `{tenant}.tahi.ph` / custom domain | `CustomerAccount` (per tenant) | Passwordless email OTP / magic link | — | `__Host-tahi_cust` |

**Why separate platform identities?** A compromised tenant staff account must never escalate into platform access, and platform accounts carry much stricter policies (MFA, IP allow-listing possible, shorter sessions).

**Why per-tenant customers?** A bride who orders from two ateliers is two separate data subjects for two separate controllers (Data Privacy Act). Per-tenant identity avoids cross-tenant linkage and simplifies isolation.

## 2. Sessions

| Property | Value |
|---|---|
| Token | 32 random bytes (`crypto.randomBytes`), base64url, sent only in the cookie |
| Storage | `Session.tokenHash = SHA-256(token)`. The raw token is never stored. Looked up in PostgreSQL by unique index; no Redis cache for now (ADR-019). |
| Cookie | `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain` attribute |
| Lifetime: staff | Sliding 7 days idle, absolute 30 days |
| Lifetime: admin | Sliding 30 min idle, absolute 12 h |
| Lifetime: customer | Sliding 30 days, absolute 90 days |
| Rotation | Token rotated on login, privilege change, MFA step-up and tenant switch (prevents fixation) |
| Revocation | `revokedAt` set and Redis key deleted. Takes effect within one request. |
| Mass revocation | On password change/reset, account suspension, membership removal or tenant suspension |
| Device list | Users can view and revoke their sessions |

The brief's "refresh token rotation" requirement applies only to JWT designs. With opaque sessions, the equivalents are token rotation on privilege change and server-side revocation.

## 3. Flows

### 3.1 Staff sign-up and tenant onboarding
```
POST /api/v1/auth/register {email, password, name}
  → User(status=PENDING_VERIFICATION) + AuthToken(purpose=VERIFY_EMAIL) → email (worker)
GET  /verify?token=… → POST /api/v1/auth/verify-email {token}
  → User ACTIVE, session created
POST /api/v1/onboarding/tenant {businessName, slug, …}
  → Tenant(PENDING_APPROVAL | TRIAL) + TenantDomain(slug.tahi.ph) + system Roles
    + OWNER membership + default settings/templates/workflow   (one transaction)
```

### 3.2 Login (staff)
1. `POST /api/v1/auth/login {email, password}`. Throttled (section 5).
2. Verify Argon2id. Use a constant-time dummy verify when the user is unknown (prevents user enumeration).
3. If MFA is enabled, return `202 {mfaRequired}` with a short-lived pre-auth session. `POST /auth/mfa` with the TOTP code completes login.
4. Create the session. `activeMembershipId` = last used or only membership. With several memberships, the UI shows a picker.
5. Response: user, memberships and permissions for the active membership.

### 3.3 Password reset
- `POST /auth/forgot-password {email}` always returns 202 (no enumeration).
- Token: 32 random bytes, SHA-256 stored, 30 min TTL, single use.
- `POST /auth/reset-password {token, password}` sets the new hash, revokes all sessions and sends a notification email.

### 3.4 Staff invitation
- An Owner or Admin invites by email and role. This creates `TenantMembership(INVITED)` and an `AuthToken(INVITE, 7 days)`.
- Accepting links an existing `User` or creates one.

### 3.5 Customer (storefront)
- `POST /api/v1/customer/auth/start {email}` sends a 6-digit OTP (10 min TTL, 5 attempts) and a magic link.
- `POST /customer/auth/verify` upserts `CustomerAccount` (scoped to the tenant from Host), links or creates a `Client` and creates a session.
- Guest booking and inquiries require no account; they use email confirmation.

### 3.6 Platform admin
- Accounts are created only by a Super Admin, or via the CLI seed for the first Super Admin. Self-registration does not exist.
- TOTP enrollment is mandatory on first login. Recovery codes are hashed.
- Sensitive actions (suspend tenant, impersonation, refunds) require re-authentication within 5 min (step-up).

## 4. Password and secret handling

- **Argon2id** (`argon2` npm package): memory 19 MiB, iterations 2, parallelism 1 (OWASP baseline), tuned on the VPS.
- Passwords: 10–128 characters, checked against a breached-password list (k-anonymity HIBP check, optional/configurable). No composition rules.
- TOTP secrets and tenant provider credentials are encrypted with AES-256-GCM using a key from the environment (`ENCRYPTION_KEY`), with a key id stored to allow rotation.

## 5. Throttling and abuse protection

| Target | Limit (initial) | Store |
|---|---|---|
| Login per IP | 20 / 15 min | Redis |
| Login per account | 5 failures → exponential backoff (1, 2, 4… min), alert at 20 | Redis + DB counter |
| Forgot password / OTP send | 3 / 15 min per email, 20 / h per IP | Redis |
| OTP verify | 5 attempts per code | DB |
| Public storefront forms | 10 / h per IP per tenant + Cloudflare Turnstile | Redis |

The client IP comes from `CF-Connecting-IP`, trusted only when the request arrives from Cloudflare ranges through Traefik.

## 6. CSRF and XSS

- `SameSite=Lax` cookies.
- Every state-changing request must carry an `Origin` header matching the request host.
- Double-submit CSRF token (`X-CSRF-Token` header ↔ non-HttpOnly `__Host-csrf` cookie) on all non-GET routes.
- Webhooks are exempt; they are authenticated by signature.
- Strict CSP per app (nonce-based scripts), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` (dashboard and admin).
- React escaping by default. Rich text (storefront "About") is sanitized server-side with an allow-list.

## 7. Authorization model

### 7.1 Permission catalogue (code-defined, in `packages/types`)
```
clients.read  clients.write  clients.archive
measurements.read  measurements.write
appointments.read  appointments.write  appointments.manage_settings
catalog.read  catalog.write
quotations.read  quotations.write  quotations.approve
orders.read  orders.write  orders.cancel
production.read  production.write  production.manage_workflow
production.read_assigned            # restricts to own WorkAssignments
payments.read  payments.record  payments.refund
storefront.manage
staff.read  staff.manage  roles.manage
reports.read  reports.financial
tenant.settings  tenant.billing  tenant.merchant_account  tenant.transfer_ownership
audit.read
```

### 7.2 Default tenant roles

| Permission group | Owner | Admin | Designer | Tailor | Staff |
|---|:-:|:-:|:-:|:-:|:-:|
| clients.* | ✓ | ✓ | ✓ | read | ✓ |
| measurements.* | ✓ | ✓ | ✓ | read | write |
| appointments.* | ✓ | ✓ | ✓ | read | ✓ |
| catalog.* | ✓ | ✓ | ✓ | read | read |
| quotations.* | ✓ | ✓ | ✓ (no approve*) | — | read |
| orders.* | ✓ | ✓ | ✓ | read | read/write |
| production.* | ✓ | ✓ | ✓ | read_assigned + write | read |
| payments.read / record | ✓ | ✓ | ✓ | — | ✓ |
| payments.refund | ✓ | ✓ | — | — | — |
| storefront.manage | ✓ | ✓ | ✓ | — | — |
| staff / roles | ✓ | ✓ | — | — | — |
| reports.financial | ✓ | ✓ | — | — | — |
| tenant.billing / merchant_account / transfer_ownership | ✓ | — | — | — | — |

\* "Approve" means approving internal discount overrides above a threshold. Customers accept quotations through the storefront link.

Owners can clone and edit roles. System roles cannot be deleted, and the Owner role cannot be edited.

### 7.3 Enforcement
```ts
@Controller('tenant/orders')
@Realm('tenant')
export class OrdersController {
  @Get(':id')
  @RequirePermission('orders.read')
  get(@Param('id', ParseUuid) id: string) { return this.orders.get(id); } // tenant scoping is implicit
}
```
Guard order:
1. `RealmGuard`: route realm must equal the host realm.
2. `SessionGuard`: load the session; check user, membership and tenant status.
3. `PermissionGuard`: check the permission set, cached per session.
4. Resource-level policies in services, e.g. a Tailor with only `production.read_assigned` sees only jobs with their `WorkAssignment`; staff can't refund.

Routes are **deny by default**: a global guard rejects any route lacking `@Realm()` and one of `@Public()`, `@Authenticated()` or `@RequirePermission()`, and the API refuses to start if such a route exists (ADR-019). A route on the wrong host returns 404.

### 7.4 Platform permissions
`platform.tenants.read`, `platform.tenants.manage`, `platform.tenants.access_data` (view tenant business data; requires a reason and is audited), `platform.billing.*`, `platform.settings`, `platform.admins.manage` (Super Admin only), `platform.support.*`.

**Impersonation** (Phase 7, optional): read-only by default, time-boxed (30 min), visible banner, full audit, tenant owner notified.

## 8. Account states

| Entity | States | Effect |
|---|---|---|
| User | `PENDING_VERIFICATION`, `ACTIVE`, `LOCKED`, `DISABLED` | Not ACTIVE → no session |
| TenantMembership | `INVITED`, `ACTIVE`, `DISABLED` | Not ACTIVE → cannot select the tenant |
| Tenant | see `MULTI_TENANCY.md` §9 | Read-only or blocked |
| PlatformUser | `ACTIVE`, `DISABLED` | — |

## 9. Audit events (minimum)

Login success/failure, MFA enroll/disable, password change/reset, session revoke, role/permission change, membership invite/remove, tenant status change, platform data access, payment record/refund, merchant account change, data export, data erasure.
