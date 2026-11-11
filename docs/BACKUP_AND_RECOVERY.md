# Backup & Recovery — TAHI.ph

> **Status:** Proposed (Phase 0). Implementation in Phase 1 (scripts) and Phase 8 (automation, drills).

## 1. Objectives

| Metric | Target |
|---|---|
| RPO (max data loss) | ≤ 15 minutes (WAL archiving); ≤ 24 h if only nightly dumps are running |
| RTO (time to restore service) | ≤ 4 hours on a fresh VPS |
| Retention | 7 daily, 4 weekly, 6 monthly (configurable) |
| Verification | Automated weekly restore test; manual drill quarterly |

**Docker volumes are not backups.** They live on the same disk as the database.

## 2. What is backed up

| Data | Method | Location |
|---|---|---|
| PostgreSQL | (a) nightly logical `pg_dump -Fc`; (b) continuous WAL archiving + weekly base backup (pgBackRest or wal-g) for point-in-time recovery | Off-site S3-compatible bucket (separate account/provider from primary storage, e.g. Backblaze B2 if primary is R2) |
| Object storage (uploads) | Bucket versioning + lifecycle; optional weekly `rclone sync` to the backup provider | Off-site |
| Configuration | `docker-compose.prod.yml` and scripts in git. The `.env` is kept in an offline password manager / secret vault, **never** in the backup bucket unencrypted. | — |
| Redis | Not backed up (cache + queues; jobs are re-derivable) | — |

All backups are **encrypted client-side** (age or the tool's built-in encryption) before upload. The backup bucket key is write-only from the VPS (no delete permission). Retention is enforced by bucket lifecycle rules, which protects against ransomware deleting backups.

## 3. Schedule (backup container cron, UTC)

| Job | When |
|---|---|
| `pg_dump` logical | 18:00 UTC daily (02:00 Manila, low traffic) |
| Base backup (PITR) | Sunday 19:00 UTC |
| WAL push | Continuous (`archive_command`) |
| Restore test | Monday 20:00 UTC |
| Retention prune | Daily, via lifecycle |

## 4. Integrity verification (automated restore test)

1. Download the latest dump into a throwaway `postgres` container (same major version).
2. `pg_restore`, then run sanity queries: row counts per key table within ±X% of production, latest `created_at` ≤ 26 h old, RLS policies present.
3. Record the result. Alert on failure (email + uptime monitor push).
4. Destroy the container.

## 5. Restoration procedures

### 5.1 Full restore (new VPS)
1. Provision a VPS following `DEPLOYMENT.md` §3.
2. Restore `/opt/tahi` from git plus the `.env` from the vault.
3. `docker compose up -d postgres redis`.
4. Restore:
   - **PITR:** `pgbackrest restore --type=time --target="<timestamp>"`;
   - **or logical:** `pg_restore -d tahi --role=tahi_owner latest.dump`.
5. Verify roles, RLS policies and the migration table (`_prisma_migrations`) match the release SHA.
6. Deploy the matching release: `deploy.sh <sha>`.
7. Update the Cloudflare DNS A records if the IP changed.
8. Smoke test, then announce.

### 5.2 Single-tenant data recovery
For accidental deletion by one tenant:
1. Restore into a side database.
2. Extract the tenant's rows by `tenant_id`.
3. Review.
4. Re-insert via a scripted, audited procedure.

Never restore the full DB over production for a single tenant.

## 6. Responsibilities

- The backup job owner (DevOps) watches alerts.
- The product owner approves any production restore.
- Every restore is logged in `AuditLog` and in an incident note.
