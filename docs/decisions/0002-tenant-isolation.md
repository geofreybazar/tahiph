# ADR 0002: App-layer tenant scoping + deny-all RLS

**Status:** Established (owner's brief). The limit below is a review finding the owner should read before approving.

## Decision

- Request-scoped tenant context through `nestjs-cls`.
- A Prisma client extension enforces tenant scoping, using an explicit model registry.
- RLS is enabled on all application tables with no permissive policies.
- Super-admin uses a separate unscoped client, restricted to its module.
- Composite foreign keys, indexes and unique constraints add protection at the database level.

## The important limit

With no policies, a role subject to RLS sees no rows. So the API's role must have `BYPASSRLS`, and Supabase's own Prisma guide also creates a `bypassrls` user. This means:

- **RLS protects against:** access through Supabase's Data API with the publishable key.
- **RLS doesn't protect against:** any mistake in the API.

The defences against an API bug are the extension, composite foreign keys and tests. Prisma's docs also state the `query` extension doesn't support nested reads and writes, so it can't be complete by itself. `docs/security.md` §4 specifies how the gaps are handled.

## Alternative for the record

Per-request `SET LOCAL` with tenant-aware RLS policies would make RLS a real second layer against API bugs, at the cost of wrapping every request's queries in a transaction and more complex pooling. The owner rejected this on 2026-10-27 and it isn't being reopened. It's noted only so that the trade-off stays visible.

## Consequences

- Isolation depends heavily on the test suite, which must run against real Postgres.
- Every new tenant model needs registry, composite foreign key, RLS and test work. CI checks enforce this.
