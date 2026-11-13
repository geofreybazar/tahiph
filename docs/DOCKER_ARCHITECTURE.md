# Docker Architecture — TAHI.ph

> **Status:** Phase 1 implemented: `infrastructure/docker/*.Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml` and `infrastructure/traefik/`. **Not yet run locally** (no Docker in WSL). Images are built and smoke-tested in CI. The backup container is Phase 8.
> **Local note:** the Docker CLI is not currently available in the development WSL environment. Enable Docker Desktop WSL integration or install Docker Engine before Phase 1.

## 1. Services

| Service | Image | Networks | Published ports | Health check | Notes |
|---|---|---|---|---|---|
| `traefik` | `traefik:v3.x` (pinned) | edge | 80, 443 | `traefik healthcheck` | Only service with public ports. Docker provider via socket proxy. |
| `socket-proxy` | `tecnativa/docker-socket-proxy` | socket | — | — | Exposes read-only container listing to Traefik |
| `dashboard` | `ghcr.io/<org>/tahi-dashboard:<sha>` | edge | — | `GET /healthz` | Next.js standalone |
| `storefront` | `ghcr.io/<org>/tahi-storefront:<sha>` | edge | — | `GET /healthz` | Next.js standalone; ISR cache on a volume or in-memory |
| `admin` | `ghcr.io/<org>/tahi-admin:<sha>` | edge | — | `GET /healthz` | Optional IP allow-list middleware |
| `api` | `ghcr.io/<org>/tahi-api:<sha>` | edge, internal | — | `GET /api/health/ready` | `node dist/main.js` |
| `worker` | same image as `api` | internal | — | process check + queue heartbeat | `node dist/main.worker.js` |
| `migrate` | same image as `api` | internal | — | — | One-shot: `prisma migrate deploy` as `tahi_owner`. Compose profile `migrate`. |
| `postgres` | `postgres:<17|18>-alpine` (pinned) | internal | **none** | `pg_isready` | Volume `pgdata`; init SQL creates roles and extensions |
| `redis` | `redis:7-alpine` (pinned; or Valkey) | internal | **none** | `redis-cli ping` | `requirepass`, AOF, volume `redisdata` |
| `backup` | custom image with `pg_dump` + `rclone`/wal-g | internal | — | — | Cron schedule; uploads off-site |

## 2. Networks

```
            Internet ─► Cloudflare ─► :443
                                        │
┌──────────────────── edge (bridge) ────┴───────────────────────────┐
│ traefik   dashboard   storefront   admin   api                    │
└─────────────────────────────────────────┬─────────────────────────┘
┌──────────────── internal (bridge, internal: true) ───┴────────────┐
│ api   worker   migrate   postgres   redis   backup                │
└───────────────────────────────────────────────────────────────────┘
┌──── socket (internal: true) ────┐
│ traefik   socket-proxy          │
└─────────────────────────────────┘
```

- `internal` is declared `internal: true`, so it has no outbound internet. The worker and backup need egress (Resend, PayMongo, R2), so they also join an `egress` network. Final topology is validated in Phase 1.
- The frontends do not join `internal`, so they can't reach Postgres or Redis even if compromised. They reach the API over `edge` (`http://api:3000`).

## 3. Traefik routing (labels, illustrative)

```yaml
api:
  labels:
    - traefik.enable=true
    - traefik.http.routers.api.rule=PathPrefix(`/api`) && (Host(`app.tahi.ph`) || Host(`admin.tahi.ph`) || HostRegexp(`^[a-z0-9-]+\.tahi\.ph$`) || Host(`api.tahi.ph`))
    - traefik.http.routers.api.priority=100          # beats frontend catch-alls
    - traefik.http.routers.api.middlewares=secure-headers,cf-real-ip
storefront:
  labels:
    - traefik.http.routers.storefront.rule=HostRegexp(`^[a-z0-9-]+\.tahi\.ph$`)
    - traefik.http.routers.storefront.priority=10
```

- Custom domains (Phase 5+) use a catch-all router at the lowest priority, pointing to the storefront and API. Unknown hosts get a 404 from the app, after the `TenantDomain` lookup.
- TLS: Let's Encrypt **DNS-01 via the Cloudflare API** for `tahi.ph` and `*.tahi.ph`. Custom-domain TLS is terminated at Cloudflare for SaaS. The origin uses a Cloudflare Origin CA certificate or the same wildcard.
- Middlewares:
  - `secure-headers` (HSTS, nosniff, referrer policy);
  - `cf-real-ip`: trust forwarded headers only from Cloudflare IP ranges;
  - `admin-allowlist` (optional);
  - compression.

## 4. Images (multi-stage)

```
FROM node:<LTS>-alpine AS base            # version pinned + digest in Phase 1
FROM base AS pruner     → npx turbo prune <app> --docker
FROM base AS deps       → COPY pruned package.json/lockfile; npm ci
FROM deps AS build      → COPY source; prisma generate; turbo build --filter=<app>
FROM base AS runtime    → NODE_ENV=production; copy only build output + prod node_modules
                          USER node; HEALTHCHECK; CMD ["node", "..."]
```

- Next.js uses `output: 'standalone'`, so the runtime image has only `.next/standalone` plus static assets.
- No dev servers, compilers or source maps in runtime images (source maps are uploaded to error tracking instead).
- `.dockerignore` excludes `node_modules`, `.git`, `.env*`, `.next`, `dist`, `coverage`, `docs`.
- Labels: `org.opencontainers.image.source`, `revision`, `created`.
- Target runtime image size: under 200 MB for Next apps and under 250 MB for the API.

## 5. Runtime hardening (Compose)

```yaml
x-hardening: &hardening
  read_only: true
  tmpfs: [/tmp]
  security_opt: [no-new-privileges:true]
  cap_drop: [ALL]
  restart: unless-stopped
  logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } }
  deploy: { resources: { limits: { memory: 512m } } }
```

## 6. Volumes

| Volume | Service | Backup |
|---|---|---|
| `pgdata` | postgres | **Yes**: dump + WAL off-site (see `BACKUP_AND_RECOVERY.md`) |
| `redisdata` | redis | No (rebuildable; queues are drained or re-enqueued) |
| `traefik-acme` | traefik | Optional (certificates are re-issuable) |
| `storefront-cache` | storefront | No |

Docker volumes are **not** a backup.

## 7. Local development (`docker-compose.yml`)

- Runs only the infrastructure: `postgres` (published on `127.0.0.1:5432` for local tools), `redis`, `mailpit` (email capture) and `rustfs` (S3-compatible uploads storage on `127.0.0.1:9000`, ADR-031; MinIO no longer publishes community images, ADR-016). Create the bucket once with `npm run setup-storage -w @tahi/api`.
- Apps run on the host with `turbo dev` for fast reload. A `full` profile runs app containers for parity testing.
- Seed script: two demo tenants (A and B) for cross-tenant manual testing.

## 8. Production (`docker-compose.prod.yml`)

- Images are pulled from GHCR by SHA tag; never built on the VPS.
- `.env` lives on the VPS only.
- `depends_on` with `condition: service_healthy` for `postgres`/`redis`.
- `migrate` runs explicitly from the deploy script before `api`/`worker` are recreated.
