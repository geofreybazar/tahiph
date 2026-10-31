# ADR 0005: Separate shadcn/ui installs

**Status:** Confirmed by the owner, 2026-10-31

## Decision

`apps/admin` and `apps/web` each have their own shadcn/ui components. No `packages/ui` for now.

## Why

The two apps look different: one is a dense dashboard, the other is a designer-branded public site. A shared package means Tailwind and build configuration work before any feature exists.

## Consequences

Some components are duplicated. Revisit only when real duplication causes bugs or noticeable repeated work, and creating `packages/ui` needs the owner's approval.
