# Payment Architecture — TAHI.ph

> **Status:** Proposed (Phase 0).
> - Manual payment recording: Phase 4.
> - SaaS billing and online customer payments: Phase 6.
>
> PayMongo Platforms capabilities below come from public PayMongo documentation and **must be confirmed with PayMongo** before implementation (section 7).

## 1. Two ledgers, never mixed

| Ledger | Money flows | Owner | Tables | Provider account |
|---|---|---|---|---|
| **A. SaaS subscriptions** | Tenant → TAHI | TAHI | `Subscription`, `SubscriptionInvoice`, `PlatformTransaction(type=SUBSCRIPTION_PAYMENT)` | TAHI's own PayMongo merchant account |
| **B. Customer payments** | Customer → Tenant | Tenant | `OrderPayment`, `PaymentTransaction`, `Refund` (all tenant-scoped, RLS) | Tenant's **PayMongo child account** under TAHI's Platforms account (or the tenant's own keys as fallback), or manual |

Rules:
- **TAHI's only revenue is tenant subscriptions (ledger A).** TAHI takes **no cut, commission or application fee** on tenant sales (decided 2026-11-11). 100% of every customer payment (minus PayMongo's own processing fees) belongs to the tenant.
- Ledger B rows never appear in TAHI revenue reports. Ledger A rows never appear in tenant reports.
- No code path may move money from ledger B into TAHI's accounts. There is no `APPLICATION_FEE` transaction type.
- Reconciliation jobs run per ledger.

## 2. Ledger A — SaaS billing (TAHI-owned engine)

TAHI does not depend on provider-side recurring subscriptions. The worker runs the billing engine:

```
daily billing job
 ├─ trials ending in 3 days      → reminder email
 ├─ periods ending today         → create SubscriptionInvoice(OPEN) + PayMongo checkout link → email
 ├─ invoices OPEN past due date  → Subscription PAST_DUE (grace N days, configurable)
 ├─ PAST_DUE beyond grace        → Tenant SUSPENDED (read-only)
 └─ webhook payment.paid         → Invoice PAID, PlatformTransaction, extend period, reactivate
```

- **Upgrades:** take effect immediately, with a prorated invoice for the remainder of the period.
- **Downgrades:** take effect at period end. Limits are validated first (e.g. staff seats).
- **Cancellation:** at period end; the tenant moves to `CANCELLED` (export window).
- **Manual invoices:** platform admins can record bank-transfer payments for invoices, with audit.

## 3. Ledger B — tenant customer payments

### 3.1 Manual payments (MVP, Phase 4)
These are the dominant real-world flow: cash, GCash/Maya transfer, bank transfer.
- Staff record the amount, method, date, reference number and an optional proof image. This creates an `OrderPayment(status=SUCCEEDED)` and a receipt number from `TenantCounter`.
- Corrections are made by voiding (`status=VOIDED` with reason) and recording again. Payments are never edited in place.
- Receipts are **Acknowledgment Receipts** (not BIR sales invoices). See risk R3.

### 3.2 Online payments via PayMongo Platforms (Phase 6)
From PayMongo's public docs:
- A parent (platform) account can create **child accounts** through the Accounts API.
- Child activation requires business details (trade name, address, TIN).
- Payments can be **split** across connected accounts, and the parent can optionally take a platform fee. **TAHI does not use the fee feature**: the full amount routes to the tenant's child account.
- Each parent–child relationship has an authorization toggle.

**Onboarding (per tenant):**
```
Owner → "Enable online payments"
  → API creates PayMongo child account (Accounts API) with BusinessProfile data
  → TenantMerchantAccount(mode=PLATFORM_CHILD, status=PENDING_KYC)
  → owner completes KYC (PayMongo-hosted flow or document upload, TBC)
  → webhook / polling → status=ACTIVE, capabilities stored
```

**Payment:**
```
Customer clicks "Pay balance" on storefront order page
  → API validates order, amount ≤ balance
  → PaymentTransaction(PENDING) + idempotency key = hash(orderId, amount, attempt)
  → PayMongo checkout session created on behalf of the child account; 100% of the amount routes to the tenant (no TAHI fee)
  → redirect → customer pays (GCash / Maya / card / QR Ph / online banking per capabilities)
  → webhook payment.paid → (see §4) → OrderPayment(SUCCEEDED, method=ONLINE)
  → customer redirected to success page, which **polls status**; the redirect itself is never trusted
```

**Fallback (if Platforms is not approved for TAHI):** `mode=OWN_KEYS`. The tenant pastes their own PayMongo secret key and webhook secret. These are encrypted with AES-256-GCM, never returned to the client, and rotatable. Since TAHI takes no fee, this mode is functionally equivalent for tenants. The difference is onboarding UX: the tenant manages their own PayMongo account.

## 4. Webhook handling (both ledgers)

```
POST /api/v1/webhooks/paymongo            (api.tahi.ph — no session, no CSRF)
  1. Read raw body (rawBody enabled only on this route)
  2. Verify Paymongo-Signature (HMAC-SHA256, timestamp tolerance 5 min, constant-time compare)
       - which secret: platform secret, or per-tenant secret (OWN_KEYS) resolved by route
         /webhooks/paymongo/t/{merchantAccountId}
  3. INSERT webhook_event (provider, event_id, …) ON CONFLICT DO NOTHING
       → if conflict: return 200 (duplicate, already accepted)
  4. Enqueue `webhooks:process {webhookEventId}` → return 200 quickly
worker:
  5. Load event, resolve ledger + tenant from metadata (our own ids stored in checkout metadata,
     cross-checked against PaymentTransaction.providerPaymentId — metadata alone is not trusted)
  6. Apply state transition in a transaction; transitions are monotonic
     (PENDING→SUCCEEDED ok; SUCCEEDED→PENDING ignored; amounts must match)
  7. Mark webhook_event processed / failed (retries with backoff, DLQ + alert)
```

## 5. Provider abstraction

```ts
interface PaymentProvider {
  readonly name: 'paymongo' | 'manual';
  createCheckout(input: CheckoutInput, ctx: MerchantContext): Promise<CheckoutResult>;
  getPayment(providerPaymentId: string, ctx: MerchantContext): Promise<ProviderPayment>;
  refund(input: RefundInput, ctx: MerchantContext): Promise<ProviderRefund>;
  verifyWebhook(rawBody: Buffer, headers: Headers, secret: string): boolean;
  parseEvent(rawBody: Buffer): NormalizedPaymentEvent;
}
type MerchantContext =
  | { ledger: 'platform' }
  | { ledger: 'tenant'; tenantId: string; merchantAccount: TenantMerchantAccount };
```

Domain services (`BillingService`, `PaymentsService`) depend on the interface, never on PayMongo SDK types.

## 6. Refunds and reconciliation

- **Refunds:** `Refund(PENDING)`, then a provider call, then a webhook marks it `SUCCEEDED`/`FAILED`. Manual refunds are recorded directly. Refunds require `payments.refund` and the total cannot exceed the payment amount (checked under row lock).
- **Reconciliation:** a daily worker job per ledger and per merchant account lists provider payments for the previous day and compares them with local records:
  - missing locally → alert, then fetch and apply;
  - amount mismatch → alert;
  - stuck PENDING > 24 h → poll the provider.

  Results are stored in a `ReconciliationRun` (Phase 6).
- **Audit:** every payment state change writes to `TenantAuditLog` (B) or `AuditLog` (A).

## 7. Open items to confirm with PayMongo (before Phase 6)

| # | Question |
|---|---|
| P1 | Is Platforms/Linked Accounts available to TAHI's account, and under what pricing (listed as custom/enterprise)? |
| P2 | Child KYC requirements: can sole proprietors with DTI registration, or unregistered home-based ateliers, onboard? |
| P3 | Is KYC hosted by PayMongo, or must TAHI collect documents? (TAHI collecting IDs increases DPA obligations.) |
| P4 | Are child-account payment events delivered to the parent's webhook? Is there an account identifier on events? |
| P5 | Can a payment be created on behalf of a child account with 100% routed to the child (no parent fee)? Who bears PayMongo's processing fees (child, as expected)? Are all methods (GCash, Maya, cards, QR Ph) supported for child accounts? |
| P6 | Refunds on child-account payments: initiated by the parent via API, or only by the child? |
| P7 | Settlement/payout schedule to child accounts; payout reports API? |
| P8 | Chargeback/dispute liability between parent and child |
| P9 | Does PayMongo offer recurring billing that would simplify ledger A? (The design does not depend on it.) |
| P10 | Since TAHI earns nothing from tenant payments, does Platforms pricing (custom/enterprise) justify itself over tenants connecting their own accounts (OWN_KEYS)? Decide after the quote. |

## 8. Security

- Amounts are always computed server-side from the order and never accepted from the client.
- Idempotency keys are sent on every provider call that creates something.
- Provider secrets are stored in environment variables (platform) or encrypted columns (tenant OWN_KEYS), never logged. Logs redact `authorization`, `card*` and `secret*` fields.
- TAHI never handles raw card data. Hosted checkout only keeps TAHI out of PCI DSS scope (SAQ A).
