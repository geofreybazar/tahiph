# ADR 0003: Supabase Auth, verified through JWKS

**Status:** Established (owner's brief)

## Decision

Supabase Auth authenticates users. `apps/api` verifies access tokens against the project's JWKS endpoint, checking signature, algorithm allowlist, issuer, audience (`authenticated`) and expiry. Application users, memberships and platform admins live in the application's own tables.

## Why

Verification needs no shared secret and no call to Supabase per request, and asymmetric keys can be rotated through JWKS.

## Consequences

- Tokens can't be revoked immediately, so the API checks membership and tenant status in the database on every tenant request.
- Roles never come from token metadata the user can influence.
- `users` has no foreign key to `auth.users`; rows are created on first verified request.
- The built-in email provider allows 2 emails per hour, so custom SMTP is needed before real use.
