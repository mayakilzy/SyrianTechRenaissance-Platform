# STR Platform — Backup & Restore Runbook (G10-03)

> How to back up, restore, migrate, and recover the STR Platform PostgreSQL
> database in staging. This runbook covers operational safety for the staging
> environment. Production launch has additional requirements listed at the end.

---

## 1. Scope and Assumptions

| Item | Value |
|------|-------|
| Database | PostgreSQL 17 (postgres:17-alpine) |
| Compose service | `postgres` in `docker-compose.staging.yml` |
| Container name | `str-staging-postgres` |
| Volume | `str-staging-pgdata` |
| DB name | `str_platform` |
| DB user | `str` |
| Backup host path | `REQUIRES_MASTER_INPUT` (see §2) |

This runbook assumes all commands are run from the repository root on the
staging server, with `.env.staging` already populated.

---

## 2. Backup Procedure

### 2.1 Where to store backups — `REQUIRES_MASTER_INPUT`

The backup destination MUST be configured by MASTER before staging go-live.
Recommended options (MASTER decides):

- A separate volume mounted on the host (e.g., `/var/backups/str-staging/`).
- An off-host destination (S3-compatible bucket, rsync target, etc.).
- A dedicated backup container with its own schedule (e.g., `pgbackrest`).

Until MASTER provides the destination, store backups in a temporary path
under the operator's home directory (`~/str-backups/`) and copy them off
the server manually after each backup.

### 2.2 Manual backup (on-demand)

```bash
# From the staging server, repo root
TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="${STR_BACKUP_DIR:-$HOME/str-backups}"
mkdir -p "$BACKUP_DIR"

# Logical backup (small, portable, restorable across PG versions)
docker compose -f docker-compose.staging.yml exec -T postgres \
  pg_dump -U str -d str_platform --no-owner --clean --if-exists \
  > "$BACKUP_DIR/str-staging-$TS.sql"

# Show result
ls -lh "$BACKUP_DIR/str-staging-$TS.sql"
sha256sum "$BACKUP_DIR/str-staging-$TS.sql" | tee "$BACKUP_DIR/str-staging-$TS.sql.sha256"
```

### 2.3 What the backup contains

- All tables in the `str_platform` database.
- All Prisma migrations history (`_prisma_migrations` table).
- All seed data and any data entered via the staging UI.

### 2.4 What the backup does NOT contain

- Docker images (those are reproducible from the Git SHA + `docker build`).
- `.env.staging` secrets (back those up separately, NEVER in the same
  location as the DB dump).
- Volume metadata (only the SQL content matters — Postgres state is
  fully captured by `pg_dump`).

### 2.5 Scheduled backup (recommended for staging)

Once MASTER provides a backup destination, add a cron entry on the host:

```cron
# /etc/cron.d/str-staging-backup
# Daily at 03:00 server time
0 3 * * * root /usr/local/bin/str-staging-backup.sh >> /var/log/str-staging-backup.log 2>&1
```

The `str-staging-backup.sh` script wraps §2.2 and rotates old backups
(keep last 14 daily + 4 weekly). `REQUIRES_MASTER_INPUT`: MASTER must
approve the script's installation on the server.

---

## 3. Restore Procedure

### 3.1 Pre-restore checklist

- [ ] Confirm the target environment is stopped: `docker compose -f docker-compose.staging.yml stop app worker`
- [ ] Confirm the backup file exists and the SHA256 matches.
- [ ] Confirm the postgres container is still running (do NOT destroy it
      unless you intend to recreate the database from scratch).

### 3.2 Restore into the existing database (data replace)

```bash
BACKUP_FILE="/path/to/str-staging-YYYYMMDDTHHMMSSZ.sql"

# Stop app + worker (postgres stays up)
docker compose -f docker-compose.staging.yml stop app worker

# Restore
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U str -d str_platform < "$BACKUP_FILE"

# Restart app + worker
docker compose -f docker-compose.staging.yml up -d app worker

# Verify readiness
curl -fsS http://localhost:3000/api/v1/ready
```

### 3.3 Restore into a fresh database (disaster recovery)

Use this when the volume is corrupted or you want to recreate from scratch.

```bash
# WARNING: this destroys the existing staging database volume.
docker compose -f docker-compose.staging.yml down -v
docker compose -f docker-compose.staging.yml up -d postgres

# Wait for postgres to be healthy
docker compose -f docker-compose.staging.yml exec postgres \
  pg_isready -U str -d str_platform

# Apply schema (migrate deploy)
docker compose -f docker-compose.staging.yml up migrate

# Restore data
BACKUP_FILE="/path/to/str-staging-YYYYMMDDTHHMMSSZ.sql"
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U str -d str_platform < "$BACKUP_FILE"

# Start app + worker
docker compose -f docker-compose.staging.yml up -d app worker
```

### 3.4 Post-restore verification

```bash
# 1. Health (process alive)
curl -fsS http://localhost:3000/api/v1/health | jq .

# 2. Readiness (DB reachable)
curl -fsS http://localhost:3000/api/v1/ready | jq .

# 3. Row counts (sanity)
docker compose -f docker-compose.staging.yml exec postgres \
  psql -U str -d str_platform -c \
  "SELECT (SELECT COUNT(*) FROM \"User\") AS users, (SELECT COUNT(*) FROM \"OutboxEvent\") AS outbox_events;"

# 4. Worker health (logs)
docker compose -f docker-compose.staging.yml logs --tail=20 worker
# Look for: outbox.worker.start
```

---

## 4. Migration and Rollback Guidance

### 4.1 Migration types

| Type | Command | When to use | Reversible? |
|------|---------|-------------|-------------|
| Deploy | `bunx prisma migrate deploy` | Staging/production. Applies pending migrations only. | No (forward-only) |
| Dev | `bunx prisma migrate dev` | Local dev only. Creates new migration files. | Yes (creates a rollback migration) |
| Reset | `bunx prisma migrate reset` | Local dev ONLY. Drops all data and re-applies. | N/A (destructive) |
| Status | `bunx prisma migrate status` | Anywhere. Lists applied/pending migrations. | N/A |

### 4.2 Forward migration (staging)

```bash
# Pull latest main on the staging server
git pull origin main

# Build the new image (SHA-tagged)
SHA=$(git rev-parse HEAD)
docker build --target prod -t str-platform:staging .

# Apply migrations via the migrate service (idempotent)
docker compose -f docker-compose.staging.yml up migrate

# If migrate exits 0, restart app + worker to pick up new image
docker compose -f docker-compose.staging.yml up -d app worker
```

### 4.3 Rollback (staging)

Prisma migrations are forward-only by design. Rolling back means:

1. **Identify the last-known-good Git SHA** (e.g., the one before the
   problematic migration was merged).
2. **Restore the database** from a backup taken BEFORE the migration was
   applied (see §3).
3. **Check out that SHA** on the server, rebuild the image, and restart.

```bash
# Example: rolling back to G10-02 merge commit
git checkout 006f5f79ec1a6bcaaa02a2ed8f75e255b0f3dc1c
docker build --target prod -t str-platform:staging .

# Restore the pre-migration backup (§3.2 or §3.3)
# ...

# Restart services
docker compose -f docker-compose.staging.yml up -d
```

**Never** attempt to manually reverse a migration by editing
`_prisma_migrations` — this leaves the schema in an inconsistent state.

### 4.4 Migration rollback test (NOT_TESTED — staging acceptance)

Before production launch, MASTER must validate that a rollback
procedure works end-to-end on staging: take a backup, apply a new
migration, take a second backup, restore the first backup, and verify
the app starts cleanly. This is a staging acceptance test, not a
staging blocker — staging can run without it, but production cannot.

---

## 5. Secrets Configuration

### 5.1 Where secrets live

| Secret | Storage | Notes |
|--------|---------|-------|
| `POSTGRES_PASSWORD` | `.env.staging` (gitignored) | Generated by `openssl rand -hex 32` |
| `AUTH_SECRET` | `.env.staging` (gitignored) | Generated by `openssl rand -base64 32` |
| `GOOGLE_CLIENT_SECRET` | `.env.staging` (gitignored) | Provisioned in Google Cloud Console |
| `S3_SECRET_ACCESS_KEY` | `.env.staging` (gitignored) | When S3 is wired (optional) |
| `SMTP_PASSWORD` | `.env.staging` (gitignored) | When SMTP is wired (optional) |

### 5.2 What NEVER goes in Git

- `.env`, `.env.staging`, `.env.production` — all gitignored (`.gitignore` §"env files").
- The `.secrets/` directory (gitignored).
- Any file containing a password, token, or private key.

### 5.3 Secret rotation

- `POSTGRES_PASSWORD`: rotate by (1) generating a new password, (2) updating
  `.env.staging` on the server, (3) running `docker compose down && up -d`
  to recreate postgres with the new password (this DOES NOT destroy data
  because the volume is preserved), (4) updating `DATABASE_URL` in
  `.env.staging` to match, (5) restarting app + worker.
- `AUTH_SECRET`: rotate by updating `.env.staging` and restarting app.
  Note: this invalidates all active sessions (users will be logged out).

### 5.4 Secret backup (separate from DB backup)

`.env.staging` MUST be backed up SEPARATELY from the DB dump. Recommended:

- Store in a password manager (1Password, Bitwarden, etc.).
- Or store encrypted on the same backup destination as DB dumps, but in
  a different file with different access controls.

`REQUIRES_MASTER_INPUT`: MASTER must define the secret storage policy
before staging go-live.

---

## 6. Worker Shutdown and Restart

### 6.1 Graceful shutdown (preferred)

```bash
# Sends SIGTERM → worker completes current iteration → exits cleanly
docker compose -f docker-compose.staging.yml stop worker
# Or: docker stop str-staging-worker
```

What happens:
1. Worker receives SIGTERM.
2. AbortController fires inside `runWorkerLoop`.
3. Current iteration completes (no new job is claimed after abort).
4. In-flight job processing completes naturally.
5. Worker logs `outbox.worker.shutdown.complete` and exits 0.
6. On next start, `recoverAbandonedJobs()` re-queues any stale jobs
   (claimed for >60s without completion).

### 6.2 Forced shutdown (last resort)

```bash
# Sends SIGKILL → worker dies immediately, in-flight job is abandoned
docker compose -f docker-compose.staging.yml kill worker
```

Use this only if graceful shutdown doesn't complete within 30s (the
worker has a 30s forced-exit timer as a last resort, so this should be
rare). After a forced shutdown, any in-flight job is left in `running`
status and will be re-queued by `recoverAbandonedJobs()` on the next
start (after 60s lease expiration).

### 6.3 Restart after crash

```bash
docker compose -f docker-compose.staging.yml up -d worker
```

The worker's `restart: always` policy handles this automatically. On
startup, it runs `recoverAbandonedJobs()` which:
- Re-queues any `IntegrationJob` with `status="running"` and
  `claimedAt < (now - 60s)`.
- Re-queues any `OutboxEvent` with `dispatchedAt=null` and
  `claimedAt < (now - 60s)`.

This means: a worker crash mid-job does NOT lose the job. It is
re-processed on the next worker start, within 60s of the crash.

---

## 7. Service Health Checks

### 7.1 Web app

| Endpoint | Method | Expected | Meaning |
|----------|--------|----------|---------|
| `/api/v1/health` | GET | 200 | Process is alive (liveness). Does NOT check DB. |
| `/api/v1/ready` | GET | 200 (DB up) or 503 (DB down) | App is ready to serve traffic (readiness). |

Use liveness for Docker healthcheck and orchestrator restart decisions.
Use readiness for load balancer routing decisions.

### 7.2 Worker

The worker has no HTTP server. Monitor via logs:

| Log entry | Meaning |
|-----------|---------|
| `outbox.worker.start` | Worker entered the polling loop. |
| `outbox.job.completed` | A job was processed successfully. |
| `outbox.worker.shutdown.complete` | Worker exited cleanly after SIGTERM. |
| `outbox.worker.error` | An error occurred in the polling loop (recoverable). |
| `outbox.worker.fatal` | Worker is exiting due to unrecoverable error. |

If no `outbox.worker.start` appears within ~30s of container start, the
worker is stuck. Restart it: `docker compose -f docker-compose.staging.yml restart worker`.

### 7.3 PostgreSQL

```bash
# Quick check
docker compose -f docker-compose.staging.yml exec postgres pg_isready -U str -d str_platform

# Connection count
docker compose -f docker-compose.staging.yml exec postgres \
  psql -U str -d str_platform -c "SELECT count(*) FROM pg_stat_activity;"
```

---

## 8. Recovery Guidance for Database Outages

### 8.1 Transient outage (PostgreSQL restart, network blip)

Symptoms:
- `/api/v1/ready` returns 503.
- `/api/v1/health` still returns 200 (process is alive).
- App logs show DB connection errors.
- Worker logs show `outbox.worker.error`.

Action:
- Wait — the app and worker will recover automatically when PostgreSQL
  is back. No restart needed.
- The worker's next iteration calls `recoverAbandonedJobs()` which
  cleans up any stale claims.

### 8.2 Prolonged outage (PostgreSQL won't start)

Symptoms:
- `/api/v1/ready` returns 503 for >5 minutes.
- `docker compose logs postgres` shows fatal errors.

Action:
1. Check disk space: `df -h`.
2. Check volume: `docker volume inspect str-staging-pgdata`.
3. If the volume is corrupted, restore from backup (§3.3).
4. If the volume is fine but postgres won't start, check the logs for
   config errors (e.g., bad `POSTGRES_HOST_AUTH_METHOD`).

### 8.3 Data corruption

If you suspect data corruption (e.g., queries return inconsistent
results, foreign key violations):

1. Stop app + worker immediately.
2. Take a forensic backup of the current state (don't overwrite the
   last-known-good backup):
   ```bash
   docker compose -f docker-compose.staging.yml exec -T postgres \
     pg_dump -U str -d str_platform > str-staging-forensic-$(date -u +%Y%m%dT%H%M%SZ).sql
   ```
3. Restore from the last-known-good backup (§3.2 or §3.3).
4. Investigate the forensic backup offline to find root cause.

---

## 9. Log Inspection and Troubleshooting

### 9.1 View logs (live)

```bash
# All services, last 50 lines, follow
docker compose -f docker-compose.staging.yml logs -f --tail=50

# Single service
docker compose -f docker-compose.staging.yml logs -f app
docker compose -f docker-compose.staging.yml logs -f worker
docker compose -f docker-compose.staging.yml logs -f postgres
```

### 9.2 Filter logs by request ID

Every log line carries a `reqId` field when available. To trace a single
request across all services:

```bash
docker compose -f docker-compose.staging.yml logs --no-color \
  | jq -c 'select(.reqId == "REQ_ID_HERE")'
```

### 9.3 Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| App container exits immediately | Invalid env (Zod validation fails) | Check `docker compose logs app` for `STR_ENV_INVALID` |
| `/api/v1/ready` returns 503 forever | DB unreachable or wrong `DATABASE_URL` | Check postgres is healthy; verify `DATABASE_URL` in `.env.staging` |
| Worker logs `outbox.worker.fatal` | DB connection error or missing Prisma client | Run `bunx prisma generate` in the image; check `DATABASE_URL` |
| App returns 500 on auth routes | `AUTH_SECRET` missing or <16 chars | Set `AUTH_SECRET=$(openssl rand -base64 32)` in `.env.staging` |
| Migrations fail with "shadow database" error | `DATABASE_SHADOW_URL` not set or unreachable | For staging, `migrate deploy` does NOT need shadow DB. If this error appears, the migrate command was wrong. |

### 9.4 Log rotation

By default, Docker captures container stdout/stderr in JSON log files at
`/var/lib/docker/containers/<id>/<id>-json.log`. These can grow unbounded.
`REQUIRES_MASTER_INPUT`: MASTER must configure Docker daemon log rotation
(`/etc/docker/daemon.json` with `log-opts: { "max-size": "10m", "max-file": "5" }`)
on the staging server.

---

## 10. Known Limitation — Interrupted Worker Recovery

> **Interrupted worker recovery during mid-processing remains NOT_TESTED.**

### 10.1 What is tested

- Worker startup (enters polling loop).
- Worker claims and processes a queued job to completion.
- Worker graceful shutdown on SIGTERM (clean exit code 0).
- Worker restart (enters polling loop again).
- Stale outbox event recovery (`claimedAt < now - 60s` → re-queue).
- Stale job recovery (`status="running"` and `claimedAt < now - 60s` → re-queue).

These are verified by G10-02 integration tests (C1–C4 in
`.github/workflows/g10-02-integration.yml`).

### 10.2 What is NOT tested

- A worker crash DURING `adapter.executeJob()` (i.e., between claiming
  the job and writing the result).
- Recovery semantics when the crash happens between the
  `IntegrationJob.updateMany` (claim) and the `adapter.executeJob`
  call.
- Recovery semantics when the crash happens DURING `adapter.executeJob`
  (adapter has side effects that may have been partially applied).

### 10.3 Why this is NOT a staging blocker

- Staging runs the **mock adapter** only (no real external integrations
  are wired yet — S3, SMTP, OAuth are all optional and not configured).
- A crash during mock adapter execution has no real-world side effects.
- The lease mechanism (60s threshold) ensures the job is re-queued and
  re-processed on the next worker start.
- The mock adapter is idempotent (re-running it produces the same result).

### 10.4 Why this IS a production blocker

- Production will eventually wire real adapters (Google Drive, Slack,
  email, etc.) that have real side effects.
- A crash during a real adapter call may leave the external system in
  an inconsistent state (e.g., a file uploaded but not registered, an
  email sent but not logged).
- Before production launch, each real adapter MUST:
  1. Be idempotent (re-running it with the same `idempotencyKey` produces
     the same result without duplicating side effects).
  2. Have an integration test for crash-during-execution recovery.
  3. Document its specific recovery semantics (e.g., "on re-run, check
     if the external resource exists before re-creating").

### 10.5 Staging vs production verdict

| Concern | Staging | Production |
|---------|---------|------------|
| Interrupted worker recovery | NOT_TESTED but safe (mock adapter, idempotent) | MUST be tested per-adapter before launch |
| Blocks staging go-live? | **NO** | N/A |
| Blocks production go-live? | N/A | **YES** (once real adapters are wired) |

---

## 11. Production Launch Blockers (carried from G02)

Per `docs/PRODUCTION-READINESS-NOTES.md`, the following items MUST be
resolved before production launch. They do NOT block staging.

| # | Item | Status |
|---|------|--------|
| 1 | Test email file permissions and path privacy | Pending (only matters if `STR_TEST_MODE=1`, never in prod) |
| 2 | Prevent `STR_TEST_MODE` activation in production | Pending (add startup assertion in `src/lib/config.ts`) |
| 3 | Real email delivery service (SMTP) | Pending (currently `LogEmailService`) |
| 4 | Distributed rate limiter (Redis) | Pending (currently in-memory, single-instance only) |
| 5 | Google OIDC credentials and redirect configuration | Pending (requires founder OAuth app) |

These remain production blockers and are tracked separately from G10-03.

---

## 12. Verification Status (G10-03-VALIDATION-01)

This runbook is **documented** but backup/restore procedures have NOT
been empirically tested end-to-end in CI. Operators must treat the
procedures as written guidance, not as a verified PASS.

### 12.1 What is documented only (NOT empirically tested)

| Procedure | Status | Reason |
|-----------|--------|--------|
| §2.2 Manual backup (`pg_dump`) | DOCUMENTED | Not run in CI. Verified manually when staging is deployed. |
| §3.2 Restore into existing DB | DOCUMENTED | Not run in CI. Verified manually when staging is deployed. |
| §3.3 Restore into fresh DB | DOCUMENTED | Not run in CI. Verified manually when staging is deployed. |
| §2.5 Scheduled backup cron | DOCUMENTED | Not run in CI. Requires MASTER to install on server. |
| §4.4 Migration rollback test | DOCUMENTED | Not run in CI. Staging-only acceptance requirement. |
| §5.3 Secret rotation | DOCUMENTED | Not run in CI. |

### 12.2 What IS empirically tested in CI

| Capability | Status | CI workflow |
|-----------|--------|-------------|
| PostgreSQL 17 starts + healthcheck passes | TESTED | G10-02 integration CI (B1-B5) |
| `prisma migrate deploy` completes | TESTED | G10-02 integration CI + G10-03 staging validation CI (C2) |
| App starts and `/api/v1/health` returns 200 | TESTED | G10-02 integration CI + G10-03 staging validation CI (C4) |
| App starts and `/api/v1/ready` returns 200 | TESTED | G10-02 integration CI + G10-03 staging validation CI (C5) |
| Worker starts and enters polling loop | TESTED | G10-02 integration CI (C1) + G10-03 staging validation CI (C6) |
| Worker graceful shutdown on SIGTERM | TESTED | G10-02 integration CI (C3) |
| Staging compose `migrate` service blocks app/worker | TESTED | G10-03 staging validation CI (C7) |
| App healthcheck reaches `healthy` with `node`-based check | TESTED | G10-03 staging validation CI (C4) |
| App port is bound to `127.0.0.1` only | TESTED | G10-03 staging validation CI (B1) |
| Postgres has no host port binding | TESTED | G10-03 staging validation CI (B2) |

### 12.3 Staging-only acceptance requirements (must be done on staging server)

These MUST be performed on the actual staging server before declaring
staging "production-ready":

1. **Backup-and-restore round trip**: take a `pg_dump` backup of staging,
   drop the database, restore from backup, verify app starts cleanly
   and row counts match.
2. **Scheduled backup**: install the cron entry (§2.5), verify it runs
   at the scheduled time and produces a non-empty backup file.
3. **Secret rotation**: rotate `POSTGRES_PASSWORD` and `AUTH_SECRET`
   on staging, verify the app still works after restart.
4. **Migration rollback**: apply a new migration on staging, take a
   backup, restore the pre-migration backup, verify the app starts
   cleanly with the rolled-back schema.

### 12.4 Production readiness requirements (do NOT block staging)

These MUST be resolved before production launch. None block staging:

1. Test email file permissions (G02 carry-over).
2. Prevent `STR_TEST_MODE` in production (G02 carry-over).
3. Real email delivery service (G02 carry-over).
4. Distributed rate limiter via Redis (G02 carry-over).
5. Google OIDC credentials + redirect test (G02 carry-over).
6. Interrupted worker recovery during mid-processing (G10-03 NOT_TESTED —
   per-adapter before real adapters go live).

### 12.5 Reading guide

When this runbook says "PASS" for a capability, it means:
- The capability is implemented in the codebase AND
- Either empirically tested in CI (§12.2) OR empirically tested on
  staging (§12.3).

When this runbook says "DOCUMENTED" for a procedure, it means:
- The procedure is written down here but has NOT been run end-to-end.
- Operators must run it manually on staging and update this section
  before declaring staging "production-ready".

This distinction was added in G10-03-VALIDATION-01 per MASTER directive:
"Avoid claiming backup/restore PASS until a real disposable
backup-and-restore test succeeds."
