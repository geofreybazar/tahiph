# ADR 0004: Client portal in `apps/web`

**Status:** Confirmed by the owner, 2026-10-31

## Decision

The client portal lives in the Next.js app, on the designer's own subdomain.

## Why

- Clients stay on the designer's branded site.
- The `apps/web` server calls the API, so designer subdomains need no CORS entry.
- Clients never load an app that contains the financial dashboards.

## Consequences

- One app serves cached public pages and private portal pages. Portal routes must always be dynamic and uncached.
- Session cookies are host-only, so a client of two designers signs in separately on each.
- Custom domains need a separate sign-in design in Phase 3.
