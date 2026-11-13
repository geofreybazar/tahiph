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
Implemented in Phase 3 step 8 (ADR-031) for images; documents (pdf) are not implemented yet.
1. The client requests an upload on the owning resource (`POST /tenant/catalog/items/:id/images`, `POST /tenant/settings/logo`) with `{contentType, size}`. Allowed: jpeg/png/webp ≤ 10 MB. HEIC is not accepted (the image library cannot decode it).
2. The presigned PUT is signed for the exact key, content type and content length, and expires in 5 min. Storage may not enforce all of these (R2 is reported not to enforce the length; local RustFS does not enforce the type), so step 3 re-checks.
3. `POST …/:imageId/confirm` reads the stored object's size and type and rejects a mismatch; then the worker verifies the format from the file's bytes, re-encodes to WebP (dropping EXIF/GPS), makes a thumbnail and deletes the original. Only `READY` images are served.
4. Kept images are tenant-prefixed (`t/{tenantId}/…`); raw uploads wait under `pending/{tenantId}/…`, expired by a 1-day bucket rule. The bucket is private; images are served via 15-minute presigned GETs after an authorization check.
5. Decoding is capped at 40 megapixels (decompression bombs).

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
- Data subject rights: export (JSON/PDF per client) and erasure (anonymization respecting financial retention). See `DATABASE_DESIGN.md` §5. **Implemented (ADR-032):** JSON export and erasure for CRM clients, permission `clients.privacy`. PDF export and storefront accounts are not implemented yet.
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
