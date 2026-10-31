# ADR 0009: Client access as a per-tenant link

**Status:** **Approved by the owner, 2026-10-31.** Affects Phase 2 only.

## Context

The brief lists `client` as a global role. But a person can be a client of two designers, and being a client only means something within one tenant. A global role alone can't answer "which client record is this user, for this designer?"

## Proposal

Keep `client` as a *kind of account* in the product language, but authorize through a table:

`client_portal_access(tenant_id, user_id, client_id, status)`, unique per `(tenant_id, user_id)` and per `(tenant_id, client_id)`.

Portal requests take the tenant from the path, require an active link, and scope every query to the linked `client_id`. The client never supplies a client ID.

## Consequences

- A person can have access with several designers, each with separate data.
- Revoking one designer's access doesn't affect another's.
- A membership and a client link can exist for the same user, without conflict.
- `client` doesn't need to be stored as a role anywhere.
