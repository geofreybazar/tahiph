# CI/CD — TAHI.ph

> **Status:** Proposed (Phase 0). The CI foundation lands in Phase 1; full CD in Phase 8.

## 1. Branching

- `main` is protected, always deployable and requires PR + green checks.
- Feature branches: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`.
- Per project rule, each feature is developed on a branch, and merge to `main` (and branch deletion) happens only after product-owner approval.
- Conventional Commits.

## 2. Workflows

### `ci.yml` (on PR and push to main)
```
jobs:
  quality:      npm ci → turbo lint typecheck  (affected packages)
  test-unit:    turbo test (Vitest)
  test-int:     services: postgres, redis → prisma migrate deploy → Vitest + Supertest
                (includes cross-tenant isolation suite and RLS checks)
  e2e:          (main + nightly) Playwright against docker compose stack
  security:     npm audit --omit=dev --audit-level=high, gitleaks
  build:        turbo build (affected)
```

### `release.yml` (on push to main, after CI)
```
jobs:
  images:   matrix [dashboard, storefront, admin, api]
            docker buildx build (cache: gha) → Trivy scan (fail on HIGH/CRITICAL fixable)
            tags: ghcr.io/<org>/tahi-<app>:<git-sha>, :main
            push to GHCR (GITHUB_TOKEN, packages: write)
  deploy-staging:   environment: staging     → ssh deploy.sh <sha> → smoke tests
  deploy-production: environment: production (required reviewer = product owner)
                     → ssh deploy.sh <sha> → health verify → auto-rollback on failure
```

## 3. Deployment steps, mapped to the brief

| # | Brief requirement | Implementation |
|---|---|---|
| 1 | Run automated tests | `test-unit`, `test-int`, `e2e` |
| 2 | TypeScript checks | `turbo typecheck` (`tsc --noEmit`) |
| 3 | Linting | `turbo lint` (ESLint flat config from `packages/config`) |
| 4 | Build Docker images | `docker buildx`, multi-stage, `turbo prune` |
| 5 | Tag images | Immutable `:<sha>` plus a moving `:main` |
| 6 | Push to GHCR | `docker/login-action` with `GITHUB_TOKEN` |
| 7 | Connect securely to the VPS | SSH with a dedicated deploy key (ed25519) in GitHub Environment secrets, pinned `known_hosts` (no `StrictHostKeyChecking=no`) |
| 8 | Pull updated images | `docker compose pull` |
| 9 | Controlled Prisma migrations | `docker compose run --rm migrate` (owner role), before app restart |
| 10 | Restart affected services | `up -d --no-deps <services>` |
| 11 | Verify health | `wait-healthy.sh` + external `curl /api/health/ready`; failure → redeploy previous SHA |

## 4. Secrets and permissions

- Workflow-level `permissions: contents: read`. Jobs elevate only what they need (`packages: write`).
- Third-party actions are pinned by full commit SHA and updated via Dependabot.
- Production secrets are stored only in the `production` Environment, which has required reviewers.
- VPS credentials (`SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_HOST`, `SSH_USER`) are never echoed. `set +x` in scripts.
- The VPS pulls from GHCR with a read-only PAT (`read:packages`) stored on the VPS, or images are made public if acceptable (decide in Phase 8).

## 5. Quality gates

| Gate | Threshold |
|---|---|
| Typecheck, lint | 0 errors |
| Unit + integration tests | 100% pass |
| Coverage (domain services) | ≥ 80% lines in `apps/api/src/modules/**/services` (starts as a soft gate) |
| Cross-tenant suite | Must pass. Blocking. |
| npm audit | No high/critical in production dependencies |
| Trivy | No fixable HIGH/CRITICAL |
| Migration check | `prisma migrate diff` shows no drift; RLS policy check passes |
