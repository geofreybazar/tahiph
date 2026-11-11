# Security — TAHI.ph

> **Status:** Proposed (Phase 0). Target: OWASP ASVS Level 2.

## 1. Threat model summary

| Asset | Threats | Primary controls |
|---|---|---|
| Tenant business data (clients, measurements, photos) | Cross-tenant access, IDOR, insider/platform abuse | 4-layer tenant isolation (`MULTI_TENANCY.md`), 404-on-foreign-id, audited platform access |
| Accounts | Credential stuffing, phishing, session theft | Argon2id, throttling, MFA (mandatory for admins), HttpOnly `__Host-` cookies, session revocation |
| Payments | Forged webhooks, replay, amount tampering | HMAC verification, idempotent event store, server-computed amounts, reconciliation |
| Storefront | XSS via tenant content, spam, phishing via look-alike tenant | Output encoding, sanitized rich text, CSP, Turnstile, reserved/blocked slugs |
| Uploads | Malware, content-type spoofing, oversized files | Presigned PUT with size and type limits, magic-byte verification, image re-encoding, private bucket |
| Infrastructure | Exposed DB/Redis, leaked secrets, outdated packages | Private networks, no published ports, secrets out of git, scanning, patching |

## 2. Controls

### Application
- **Input:** Zod validation on every input. `.strict()` on auth and payment endpoints.
- **Output:** response-schema serialization (no accidental field leakage).
- **Authentication and authorization:** `AUTHENTICATION_AND_AUTHORIZATION.md`; deny-by-default guards.
- **Tenant isolation:** `MULTI_TENANCY.md`; CI cross-tenant suite.
- **CSRF:** SameSite=Lax + Origin check + double-submit token.
- **XSS:**
  - React escaping;
  - `dangerouslySetInnerHTML` banned by lint, except the sanitized rich-text component (`sanitize-html` with an allow-list);
  - nonce-based CSP.
- **CORS:** none needed for same-origin `/api`. The API rejects cross-origin credentialed requests.
- **SSRF:** the API makes no requests to user-supplied URLs. Custom-domain verification uses DNS TXT lookups, not HTTP fetches.
- **Slug and domain abuse:** reserved slugs (`admin`, `app`, `api`, `www`, `mail`, `support`, `status`, brand names…), profanity/look-alike checks and admin review for custom domains.
- **Rate limiting:** Redis-backed per realm and endpoint; Cloudflare WAF rate rules at the edge.
- **Secrets in DB:** AES-256-GCM, key from env, key id stored for rotation.
- **Logging:** PII and secret redaction. Logs never contain tokens, passwords or measurement values.

### File uploads
1. Client requests `POST /uploads/presign {purpose, contentType, size}`. The server checks the purpose's allow-list (images: jpeg/png/webp/heic ≤ 10 MB; documents: pdf ≤ 10 MB).
2. The presigned PUT is bound to the exact key, content type and content length, and expires in 5 min.
3. `POST /uploads/confirm` → the worker verifies magic bytes, re-encodes images (strips EXIF/GPS) and creates thumbnails. Files are not referenceable until confirmed.
4. Object keys are tenant-prefixed (`t/{tenantId}/…`). Private by default; served via short-lived presigned GET after an authorization check.

### Infrastructure (see `DEPLOYMENT.md`)
- Only Traefik publishes ports (80/443). PostgreSQL and Redis live on an internal Docker network with no published ports.
- Redis requires a password (`requirepass`) and has dangerous commands renamed or disabled.
- Containers run as non-root, with `no-new-privileges`, dropped capabilities and read-only root filesystems where feasible. The Docker socket is mounted **read-only into Traefik only**. A socket proxy (`tecnativa/docker-socket-proxy`) is preferred.
- Database roles follow least privilege (`tahi_owner`, `tahi_app`, `tahi_backup`).
- SSH: keys only, no root login, non-default user, fail2ban, firewall.

### Supply chain
- `package-lock.json` committed; `npm ci` in CI.
- Dependabot or Renovate for updates; `npm audit --omit=dev` gate (high/critical) in CI.
- Trivy scan of Docker images in CI; base images pinned by digest.
- GitHub Actions pinned by commit SHA, with least-privilege `permissions:` blocks.
- Secret scanning (GitHub push protection + gitleaks in CI).

## 3. Secrets management

| Secret | Where |
|---|---|
| Dev | `.env` (git-ignored), from `.env.example` with placeholders |
| CI | GitHub Actions Environments secrets (`staging`, `production`), with required reviewers for production |
| Production | `/opt/tahi/.env` on the VPS, `chmod 600`, owned by the deploy user; or Docker secrets files mounted at `/run/secrets` |

Rotation runbook for each: DB passwords, `SESSION_PEPPER`/`ENCRYPTION_KEY` (versioned), PayMongo keys, Resend key, R2 keys, Cloudflare API token (DNS-edit scope only, single zone).

## 4. Privacy (RA 10173)

- Data minimization: only collect what ateliers need. Birthdate and photos are optional.
- Privacy notice and consent checkbox on storefront forms, recorded with timestamp and policy version.
- Data subject rights: export (JSON/PDF per client) and erasure (anonymization respecting financial retention). See `DATABASE_DESIGN.md` §5.
- Breach response: detection, containment, NPC notification within 72 h where required, tenant notification. The runbook will be maintained in `docs/` (Phase 8).
- Data Processing Agreement included in the tenant Terms of Service. Appoint a DPO and register with the NPC if thresholds apply. Legal counsel is required.

## 5. Security testing

| When | What |
|---|---|
| Every PR | Lint security rules, type checks, unit/integration tests including the cross-tenant suite, `npm audit`, gitleaks |
| Every image build | Trivy |
| Phase 8 | OWASP ZAP baseline scan against staging; manual review against the ASVS L2 checklist; backup restore drill |
| Pre-launch | External penetration test (recommended) |

## 6. Incident response (outline)

1. Detect (alerts, reports).
2. Triage severity.
3. Contain (revoke sessions/keys, suspend tenant, block IPs at Cloudflare).
4. Eradicate and recover.
5. Notify (tenants, NPC).
6. Post-mortem and ADR.
