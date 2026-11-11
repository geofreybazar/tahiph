# Deployment — TAHI.ph (Self-hosted VPS)

> **Status:** Proposed (Phase 0). A runbook to implement in Phases 1 and 8. Nothing is provisioned yet.

## 1. Target environment

| Item | Value |
|---|---|
| OS | Ubuntu Server 24.04 LTS |
| Size (initial) | 4 vCPU, 8 GB RAM, 160 GB SSD, in a Singapore or Manila region for latency |
| Runtime | Docker Engine (official apt repo) + Compose plugin |
| DNS / edge | Cloudflare (proxied records, Full (strict) TLS) |
| Environments | `staging` (smaller VPS or same host with a separate Compose project) and `production` |

## 2. DNS (Cloudflare)

| Record | Type | Target | Proxy |
|---|---|---|---|
| `tahi.ph` | A | VPS IP | Proxied (marketing site; storefront app or static, TBD) |
| `app`, `admin`, `api` | A | VPS IP | Proxied |
| `*` | A | VPS IP | Proxied (tenant subdomains) |
| Custom domains (Phase 5+) | CNAME → `customers.tahi.ph` | via Cloudflare for SaaS Custom Hostnames | Proxied |

- SSL mode: **Full (strict)**.
- Enable WAF managed rules, Bot Fight Mode (exclude `/api/v1/webhooks/*`) and rate-limiting rules.
- Cloudflare's free Universal SSL covers only the first subdomain level (`*.tahi.ph`), which fits the design.

## 3. Server hardening checklist

1. Create user `deploy` (sudo), add SSH keys, and disable password authentication and root login in `/etc/ssh/sshd_config.d/hardening.conf`:
   ```
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   AllowUsers deploy
   ```
   Optionally move SSH off port 22 and/or restrict it to an admin IP or Tailscale.
2. `apt install unattended-upgrades fail2ban ufw`; enable automatic security updates.
3. Firewall:
   ```
   ufw default deny incoming
   ufw default allow outgoing
   ufw limit 22/tcp
   ufw allow 80,443/tcp      # tighten to Cloudflare IP ranges (scripted, refreshed weekly)
   ufw enable
   ```
   **Docker bypasses ufw for published ports.** Only Traefik publishes ports. Enforce it with `DOCKER-USER` iptables rules allowing 80/443 from Cloudflare ranges only.
4. Docker:
   - `/etc/docker/daemon.json`: `{"live-restore": true, "log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}, "no-new-privileges": true, "userland-proxy": false}`
   - The `deploy` user is in the `docker` group. Treat this as root-equivalent and protect the SSH key accordingly.
5. Time sync (`systemd-timesyncd`). Server timezone stays UTC.
6. Swap file (2 GB) to survive memory spikes. Set memory limits per container.

## 4. Directory layout on the VPS

```
/opt/tahi/
├── docker-compose.prod.yml   (copied by CI per release)
├── .env                      (chmod 600, never in git)
├── traefik/                  (static config, acme storage)
├── scripts/deploy.sh, backup.sh, restore.sh
└── releases.log              (deployed SHAs, for rollback)
```

## 5. Deploy procedure (automated by CI; see `CI_CD.md`)

```bash
# deploy.sh <sha>
set -euo pipefail
export TAG=$1
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate        # prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d --no-deps api worker
./wait-healthy.sh api 60
docker compose -f docker-compose.prod.yml up -d --no-deps dashboard storefront admin
./wait-healthy.sh dashboard 60 && ./wait-healthy.sh storefront 60 && ./wait-healthy.sh admin 60
curl -fsS https://app.tahi.ph/api/health/ready
echo "$(date -u +%FT%TZ) $TAG" >> releases.log
```

- **First deploy only:** create the first Super Admin. The password is read from stdin and never passed as an argument:
  ```bash
  read -rs PW && printf '%s' "$PW" | docker compose -f docker-compose.prod.yml run --rm -T api \
    node dist/cli/main.create-super-admin.js --email ops@tahi.ph --name "TAHI Ops"; unset PW
  ```
  The CLI refuses once a Super Admin exists. TOTP is enrolled at the first login on `admin.tahi.ph`.
- **Migrations** must be backward-compatible with the previous release (expand → migrate → contract), so a failed app rollout can roll back without a DB rollback.
- **Destructive migrations** (drop/rename) require explicit approval and a fresh backup taken right before.
- **Rollback:** `deploy.sh <previous-sha>` (images stay in GHCR).
- **Zero-downtime:** a short blip (seconds) is acceptable at the single-VPS stage. Blue/green via Traefik weighted services comes later if needed.

## 6. Monitoring (Phase 8)

| Concern | Tool (proposal) |
|---|---|
| Uptime / external health | Uptime Kuma on a separate small host, or a hosted pinger |
| Errors | Sentry (SaaS) or self-hosted GlitchTip |
| Host metrics | node_exporter + Prometheus + Grafana (or Netdata to start) |
| Logs | Docker json-file with rotation → Loki (later) |
| Alerts | Disk > 80%, backup failure, restore-test failure, queue DLQ > 0, 5xx rate, cert expiry |

## 7. Pre-production checklist

- [ ] Hardening checklist complete; external port scan shows only 80/443 (and SSH, if not restricted)
- [ ] Postgres and Redis unreachable from the internet (verified with nmap)
- [ ] Backups running; a restore drill completed successfully
- [ ] Secrets present only in the VPS `.env` and GitHub Environments
- [ ] Health checks green; rollback tested
- [ ] Cloudflare WAF and rate limiting configured; webhooks path excluded from bot challenges
