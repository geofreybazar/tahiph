# ADR 0006: API on Render + Docker

**Status:** Confirmed by the owner, 2026-10-31

## Decision

`apps/api` runs as a Docker image on Render. `apps/admin` and `apps/web` run on Vercel. Supabase provides the database, auth and storage.

## Why

Managed deploys, TLS and health checks mean less operational work for one part-time developer. Docker keeps a VPS move possible.

## Consequences

- Use an always-on paid plan, because free instances sleep, which also stops scheduled jobs.
- Run in the same region as Supabase; Singapore is the recommended default.
- The trusted proxy count must match Render's real setup.
- `@nestjs/schedule` jobs need locks if the API ever scales past one instance.
