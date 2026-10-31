# ADR 0001: Modular monolith in a monorepo

**Status:** Established (owner's brief)

## Context

One part-time developer is building one product with three frontend or backend surfaces that share contracts.

## Decision

- npm workspaces and Turborepo, with npm only.
- `apps/api`, `apps/admin`, `apps/web`, `packages/shared`.
- `apps/api` is a NestJS modular monolith: one module per business feature, REST under `/api/v1`, and modules call each other through exported services.
- Only `apps/api` accesses PostgreSQL.

## Consequences

- One deployment, one database and simple transactions, with no network calls between modules.
- Module boundaries depend on discipline, since nothing physically stops one module reaching into another's tables. Repositories and review enforce this.
- Three deployable apps is still real overhead for one developer. The owner has accepted this.
