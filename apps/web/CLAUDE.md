# apps/web

Next.js App Router, hosted on Vercel: public designer websites and the client portal, resolved by hostname. Not yet scaffolded.

Read first: `docs/architecture.md` §4–5, `docs/security.md` §7.

Phase 0 builds only a placeholder site on `demo.localhost:3000`. Everything else is Phase 2.

## Stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase Auth for the portal.

## Structure (planned)

```text
proxy.ts                     hostname → /[site] rewrite, session refresh
app/
├── [site]/
│   ├── (public)/            ISR: home, portfolio, collections, packages, about, inquire
│   └── portal/              dynamic, never cached
components/
lib/                         server API client, tenant resolution, supabase
```

`proxy.ts` is the Next 16 file convention. Don't create `middleware.ts`.

## Tenant resolution

1. Skip Next.js internals and static assets with the matcher.
2. Normalize the host: lower case, no port.
3. Apex and reserved subdomains (list in `packages/shared`) aren't tenants.
4. Accept exactly one label under `ROOT_DOMAIN`.
5. Rewrite to `/[site]/...`, and always derive `site` from the host, never from a client-supplied path.
6. Resolve through `GET /public/sites/resolve`. Unknown is 404. Suspended or inactive shows an unavailable page with `noindex`.

## Boundaries

- No database access. Everything goes through `apps/api`, from the server.
- Don't call the API from the browser, because designer subdomains aren't CORS origins. Client components use server actions or route handlers.
- Secrets (`INTERNAL_SERVICE_KEY`) stay server-only. Only the Supabase URL and publishable key may be `NEXT_PUBLIC_`.

## Caching: the main risk in this app

| Route | Rule |
|---|---|
| Public pages | ISR, tagged by tenant |
| `/portal/**` | Dynamic, `no-store`, no CDN caching |
| Public form submissions | Never cached |

- Anything cached must be keyed by tenant.
- No auth-dependent data in a cached page or a shared `fetch` cache.
- Add a test for a portal route's headers and for two hosts producing different content.

## Portal auth

- Server-side Supabase client, with **host-only** cookies. Never `Domain=.tahi.ph`.
- Forward the access token as a Bearer token to `/portal/:slug/...`.
- A signed-in user with no `client_portal_access` link sees a no-access page.
- Never accept a client ID from the URL as authorization. The API limits results to the linked client.

## Public forms

Submit through the server, forwarding the client IP with `INTERNAL_SERVICE_KEY`. Include spam protection (Approved). Show generic errors.

## SEO

Per host: metadata, canonical URL, Open Graph, `sitemap.xml`, `robots.txt`. Portal pages and unavailable sites are `noindex`.

## UI

Use local shadcn/ui components, and don't create `packages/ui`. Public sites are mobile-first and image-heavy, so use optimized images. Only allow image hosts from the project's Supabase Storage.
