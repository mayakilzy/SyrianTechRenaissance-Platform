# STR Platform — Operations Guide (G10-01, updated G10-03)

> How to start, stop, check, and troubleshoot the STR Platform.
>
> **Related runbooks (G10-03):**
> - `staging-deployment.md` — step-by-step staging deployment procedure.
> - `backup-restore.md` — database backup, restore, migration, and recovery.

---

## 1. Prerequisites

- Docker 24+ with Docker Compose v2
- PostgreSQL 17 (provided by docker-compose.yml or external)
- Bun 1.3+ (for dev) or Node 24+ (for prod standalone)
- `.env` file (dev) or `.env.staging` file (staging) configured from `.env.example` / `.env.staging.example`

---

## 2. Starting the Full Stack (Development)

```bash
# Start PostgreSQL + app + worker
docker compose up -d

# Or start only the database (if running app locally)
docker compose up -d postgres postgres-shadow

# Run migrations
bunx prisma migrate deploy

# Seed synthetic data
bun run db:seed

# Start the app (if not using docker compose for it)
bun run dev
```

### What starts:
- `str-postgres` — PostgreSQL 17 on port 5432
- `str-postgres-shadow` — Shadow DB on port 5433 (for Prisma migration dev)
- `str-app` — Next.js dev server on port 3000
- `str-worker` — Outbox worker (G10-01: real `runWorkerLoop`, not keepalive)

---

## 3. Starting for Staging

> **G10-03 update:** `docker-compose.staging.yml` is now a STANDALONE file
> (not an override). It includes a `migrate` service that runs
> `prisma migrate deploy` before app/worker start. See
> `staging-deployment.md` for the full step-by-step procedure.

```bash
# Build the production image
docker build --target prod -t str-platform:staging .

# Start the staging stack (postgres + migrate + app + worker)
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d

# Or start only specific services
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d postgres migrate app worker
```

### Differences from dev:
- Uses production image (no source mounts)
- `NODE_ENV=production`
- `restart: always` (not `unless-stopped`)
- JSON logs (not pretty)
- App runs `node server.js` (standalone Next.js)
- Worker runs `bun run src/worker/index.ts` (real outbox dispatcher)
- `migrate` service runs `prisma migrate deploy` before app/worker start
- App has a Docker healthcheck on `/api/v1/health`

---

## 4. Health Checks

### Liveness (is the process alive?)
```bash
curl http://localhost:3000/api/v1/health
# 200 = process is alive (does NOT check DB)
# Non-200 or timeout = process is dead → restart container
```

### Readiness (can the app serve traffic?)
```bash
curl http://localhost:3000/api/v1/ready
# 200 = DB is reachable, app is ready
# 503 = DB is unavailable, do NOT route traffic to this instance
```

### When to use which:
- **Liveness** → orchestrator liveness probe (Docker healthcheck, k8s livenessProbe)
- **Readiness** → load balancer health check, k8s readinessProbe

---

## 5. Worker Operations

### Start the worker
```bash
# Via docker compose
docker compose up -d worker

# Or standalone (needs DATABASE_URL env)
bun run src/worker/index.ts
```

### Stop the worker gracefully
```bash
docker compose stop worker
# Or: docker stop str-worker
# Or: kill -SIGTERM <pid>
```

### What happens on SIGTERM:
1. Worker receives SIGTERM
2. Current poll cycle completes (no mid-job kill)
3. If a job is in-flight, it completes naturally
4. Worker exits cleanly
5. On next start, `recoverAbandonedJobs()` re-queues any stale jobs

### Worker recovery after crash
The worker has a lease mechanism (`RECOVERY_THRESHOLD_MS = 60000`):
- Jobs claimed but not completed for >60s are considered "abandoned"
- On startup, `recoverAbandonedJobs()` re-queues abandoned jobs
- This means: if the worker crashes mid-job, the job is NOT lost
- It will be re-processed on the next worker start (within 60s of the crash)

---

## 6. Environment Variables

See `.env.example` (dev) and `.env.staging.example` (staging) for the full list.

### Critical variables:
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | YES | PostgreSQL connection string |
| `AUTH_SECRET` | YES (for auth) | Session signing secret (openssl rand -base64 32) |
| `GOOGLE_CLIENT_ID` | NO | Google OAuth (activates Google sign-in when set) |
| `GOOGLE_CLIENT_SECRET` | NO | Google OAuth secret |
| `STR_WORKER` | NO | Set to `true` in worker container |
| `LOG_LEVEL` | NO | `fatal`/`error`/`warn`/`info`/`debug`/`trace` (default: `info`) |
| `LOG_FORMAT` | NO | `json` or `pretty` (default: `json` in prod) |

---

## 7. Troubleshooting

### App won't start
1. Check `/api/v1/health` — is the process alive?
2. Check `/api/v1/ready` — is the DB reachable?
3. Check logs: `docker compose logs app`
4. Verify `DATABASE_URL` is correct and PostgreSQL is running
5. Run migrations: `bunx prisma migrate deploy`

### Worker not processing jobs
1. Check worker logs: `docker compose logs worker`
2. Look for `outbox.worker.start` log entry
3. Submit a test job and check if `outbox.job.completed` appears in logs
4. Verify `DATABASE_URL` in worker env matches the app's
5. Check if `OutboxEvent` rows exist: `SELECT COUNT(*) FROM "OutboxEvent" WHERE "dispatchedAt" IS NULL`

### Database connection failures
1. Verify PostgreSQL is running: `docker compose ps postgres`
2. Check health: `docker compose exec postgres pg_isready -U str -d str_platform`
3. Verify `DATABASE_URL` format: `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public`
4. Check PostgreSQL logs: `docker compose logs postgres`

### Worker crashes on startup
1. Check if `DATABASE_URL` is set in the worker's environment
2. Check if Prisma client is generated: `bunx prisma generate`
3. Look for `outbox.worker.fatal` in logs
4. Verify the worker can reach PostgreSQL (same network in docker compose)

---

## 8. Stopping the Full Stack

```bash
# Graceful stop (allows worker to finish current job)
docker compose stop

# Full teardown (stops + removes containers)
docker compose down

# Full teardown + remove volumes (DESTRUCTIVE — deletes DB data)
docker compose down -v
```

---

## 9. Docker Build

### Development image
```bash
docker build --target dev -t str-platform:dev .
```

### Production image
```bash
docker build --target prod -t str-platform:prod .
```

The production image:
- Uses Next.js standalone output (`node server.js`)
- Includes worker source + dependencies (`bun run src/worker/index.ts`)
- Does NOT include dev dependencies
- Same image for web and worker (different CMD)

---

## 10. Future Considerations (G10+)

- **S3/Object Storage**: currently uses placeholder readUrl. When wired,
  the `getFileReadUrl` function in `src/modules/projects/file-evidence.ts`
  must be updated to generate real signed URLs.
- **Email SMTP**: currently uses `LogEmailService` (logs only). When wired,
  a `SmtpEmailService` implementing the `EmailService` interface must be
  added, and `getEmailService()` factory updated.
- **Scanner**: file evidence has no real scanner. The `_testMarkFileAsClean`
  function is test-only. Production needs a ClamAV or equivalent integration.
- **Backup/Restore**: documented in `backup-restore.md` (G10-03). Covers
  logical backups (`pg_dump`), restores (into existing or fresh DB), and
  migration rollback procedures.

---

## 11. G10-02 — Runtime Integration Verification (CI)

The `.github/workflows/g10-02-integration.yml` workflow performs a full
runtime integration test using Docker Compose with real PostgreSQL 17.

### What it tests:
1. **PostgreSQL starts and is healthy**
2. **Prisma migrations complete** (via `bunx prisma migrate deploy`)
3. **Seed data loads** (via `bun run db:seed`)
4. **Web server starts and responds** (`/api/v1/health` → HTTP 200)
5. **Readiness with healthy DB** (`/api/v1/ready` → HTTP 200)
6. **Readiness during DB outage** (stop PostgreSQL → `/api/v1/ready` → HTTP 503)
7. **Readiness after DB recovery** (restart PostgreSQL → `/api/v1/ready` → HTTP 200)
8. **Liveness survives DB outage** (`/api/v1/health` → HTTP 200 even when DB is down)
9. **Worker startup** (container running, enters polling loop)
10. **Worker job processing** (real queued job → succeeded + outbox dispatched)
11. **Worker graceful shutdown** (SIGTERM → clean exit)
12. **Worker restart** (restarts and enters polling loop again)

### Integration commands (for local reproduction):
```bash
# Build production image
docker build --target prod -t str-platform:g10-02 .

# Use the persisted compose file in the repo
docker compose -f docker-compose.integration.yml up -d postgres
docker compose -f docker-compose.integration.yml up migrate
docker compose -f docker-compose.integration.yml up seed
docker compose -f docker-compose.integration.yml up -d app worker

# Test health
curl http://localhost:3001/api/v1/health  # → 200
curl http://localhost:3001/api/v1/ready    # → 200 (with DB) or 503 (without)

# Test DB outage
docker stop g10-02-postgres
curl http://localhost:3001/api/v1/health   # → 200 (liveness survives)
curl http://localhost:3001/api/v1/ready    # → 503 (readiness fails)
docker start g10-02-postgres
# Wait for recovery...

# Test worker shutdown
docker stop g10-02-worker  # SIGTERM → clean exit

# Cleanup
docker compose -f docker-compose.integration.yml down -v
```

### Environment Variables (no secrets):
| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://str:integration-test-password@postgres:5432/str_platform` |
| `AUTH_SECRET` | `integration-test-secret-at-least-16-chars` |
| `HOSTNAME` | `0.0.0.0` |
| `PORT` | `3000` |
| `LOG_LEVEL` | `info` |
| `LOG_FORMAT` | `json` |

### Known Limitations:
- Integration test uses disposable PostgreSQL (volume deleted on cleanup)
- No real Google OAuth (dummy credentials)
- No real S3 storage (placeholder readUrl)
- No real SMTP email (LogEmailService)
- These are staging acceptance requirements, not integration test requirements
