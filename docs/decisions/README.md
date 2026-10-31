# Architecture Decision Records

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith-monorepo.md) | Modular monolith in an npm + Turborepo monorepo | Established |
| [0002](0002-tenant-isolation.md) | App-layer tenant scoping + deny-all RLS | Established |
| [0003](0003-supabase-auth-jwks.md) | Supabase Auth, verified through JWKS | Established |
| [0004](0004-client-portal-in-web.md) | Client portal in `apps/web` | Confirmed 2026-10-31 |
| [0005](0005-separate-shadcn-installs.md) | Separate shadcn/ui installs | Confirmed 2026-10-31 |
| [0006](0006-render-docker-hosting.md) | API on Render + Docker | Confirmed 2026-10-31 |
| [0007](0007-project-is-the-order.md) | Wedding project is the order | Confirmed 2026-10-31 |
| [0008](0008-zod-source-of-truth.md) | Zod schemas with `nestjs-zod` | Zod Established; `nestjs-zod` Approved |
| [0009](0009-client-access-per-tenant.md) | Client access as a per-tenant link | Approved |

**Established:** set by the owner's brief. **Confirmed:** the owner chose it from options. **Approved:** recommended in the review and approved by the owner on 2026-10-31.
