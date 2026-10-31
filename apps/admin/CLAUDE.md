# apps/admin

React + Vite SPA, hosted on Vercel: the designer dashboard and the super-admin panel. Phase 0 in progress.

Read first: `docs/architecture.md` §4, `docs/api.md`, `docs/security.md` §3.

## Stack

React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Tailwind CSS, shadcn/ui, Supabase Auth.

## Structure (planned)

```text
src/
├── app/          router, providers, layouts
├── features/     clients/, projects/, garments/, measurements/, appointments/,
│                 payments/, expenses/, dashboard/, reports/, members/, platform/
├── components/   shared UI, plus ui/ from shadcn
└── lib/          api client, supabase client, tenant selection, money and date formatting
```

## Boundaries

- All business data goes through `apps/api`. Use Supabase only for auth; never query tables or Storage directly except uploading to a signed URL the API issued.
- Only the publishable key may be present. Everything in `VITE_*` is public.
- No business rules that aren't also enforced by the API.

## Auth and tenants

- `supabase-js` handles sessions and refresh. The API client attaches the access token and `X-Tenant-Id`.
- Memberships come from `GET /me`, and the switcher only offers those.
- **Every tenant query key includes the tenant ID. Switching tenant clears the query cache.**
- A remembered tenant is only a preference. On `403 TENANT_ACCESS_DENIED`, clear it and return to the selector.

## Roles and routes

- Route guards and role-based navigation are for user experience; the API is the real control.
- Staff: don't request or show financial dashboards, reports, tenant-wide payments or expenses. Do show per-client price, payments and balance.
- Super-admin screens live in `features/platform`, under `/platform`, loaded lazily, and shown only when `GET /me` reports platform access.

## Forms and data

- React Hook Form with Zod resolvers using schemas from `packages/shared`. Don't duplicate them.
- TanStack Query for server state; don't copy it into local stores.
- Handle API errors by code; map `VALIDATION_ERROR.details` to fields.

## Formatting

- Money arrives as centavos. Format only for display, in `lib`.
- Convert typed peso amounts to centavos without float arithmetic.
- Display moments in Asia/Manila. Send UTC moments and `YYYY-MM-DD` calendar days.

## Security

- No `dangerouslySetInnerHTML` on user content.
- Sessions are readable by JavaScript, so XSS is serious. Keep third-party scripts to a minimum.

## UI

Use local shadcn/ui components, and don't create `packages/ui`. Every data screen needs loading, empty and error states. Dashboards must work on a tablet in the atelier.
