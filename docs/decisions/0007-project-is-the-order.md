# ADR 0007: Wedding project is the order

**Status:** Confirmed by the owner, 2026-10-31 (first decided 2026-10-27)

## Decision

There is no `orders` table. A `wedding_projects` row holds the order's number, price and payment schedule. Production stages are on `garments`. The Orders module in the UI is a view over projects.

## Why

One wedding usually has one contract and one balance. Keeping one model avoids a second set of balance rules.

## Consequences

- Payments attach to a project.
- Bride and entourage can't be invoiced separately under one project. Workarounds are separate projects, or a later model change, which would be a significant migration.
