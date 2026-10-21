# STR Platform — Staging Deployment Runbook (G10-03)

> Step-by-step procedure for deploying the STR Platform to a staging server.
> This runbook covers the mandatory path. Optional integrations (S3, SMTP,
> OAuth) are listed at the end and require separate MASTER authorization.

---

## 0. Pre-flight (mandatory, before step 1)

- [ ] MASTER has confirmed the server is provisioned and accessible via SSH.
- [ ] MASTER has provided the staging domain name (e.g., `staging.str.platform`).
- [ ] MASTER has chosen the reverse proxy: **Caddy** OR **Nginx Proxy Manager**.
- [ ] The repository is cloned on the server and `main` is at the expected SHA.
- [ ] The operator has `sudo` access for Docker installation (if not pre-installed).
- [ ] A backup destination has been defined (see `backup-restore.md` §2.1).

**Expected baseline SHA (post-G10-02 merge):**
```
006f5f79ec1a6bcaaa02a2ed8f75e255b0f3dc1c
```

If `git log -1 --format=%H` on the server does not match, STOP and verify
with MASTER before proceeding.

---

## 1. Server Prerequisites (mandatory)

### 1.1 Operating system and architecture

- Linux x86_64 (Ubuntu 22.04 LTS or Debian 12 recommended).
- ARM64 (aarch64) supported but NOT_TESTED in CI (CI runs on x86_64).
  If deploying to ARM64, MASTER must validate the image runs locally
  before staging go-live.
- `REQUIRES_MASTER_INPUT`: actual OS version and architecture of the
  staging server.

### 1.2 Docker Engine and Compose

- Docker Engine 24+ (verified with `docker --version`).
- Docker Compose v2 (verified with `docker compose version` — note:
  v2 is a plugin, not the legacy `docker-compose` Python script).
- Docker daemon log rotation configured (see `backup-restore.md` §9.4).

### 1.3 CPU, RAM, disk

Minimum recommendations for staging (low traffic, single instance):

| Resource | Minimum | Recommended | Notes |
|----------|---------|-------------|-------|
| CPU | 2 vCPU | 4 vCPU | Bun + Node + Postgres share the host |
| RAM | 4 GB | 8 GB | Postgres `shared_buffers` defaults to 128 MB |
| Disk | 20 GB | 40 GB | Includes Postgres data + Docker images + logs |
| Disk type | SSD | NVMe | Spinning disk will make staging painfully slow |

`REQUIRES_MASTER_INPUT`: actual server specs. If below minimum, escalate.

### 1.4 Firewall and port exposure

Only these ports should be exposed externally:

| Port | Service | Exposed to |
|------|---------|------------|
| 22 | SSH | Restricted (operator IPs only) |
| 80 | HTTP (proxy) | Public (for ACME http-01 challenge) |
| 443 | HTTPS (proxy) | Public |

The following MUST NOT be exposed externally:

- 3000 (app) — only the reverse proxy should reach it, via the Docker network.
- 5432 (postgres) — internal Docker network only (already enforced by `expose:` not `ports:` in staging compose).

### 1.5 Domain and HTTPS prerequisites

- DNS A record for the staging domain pointing to the server's public IP.
- Ports 80 and 443 open on the firewall (for Let's Encrypt ACME challenge).
- `REQUIRES_MASTER_INPUT`: the actual staging domain name.

---

## 2. Required Environment Configuration (mandatory)

### 2.1 Create `.env.staging` from the template

```bash
cp .env.staging.example .env.staging
```

### 2.2 Generate the mandatory secrets

```bash
# POSTGRES_PASSWORD (database)
openssl rand -hex 32

# AUTH_SECRET (session signing)
openssl rand -base64 32
```

### 2.3 Fill in `.env.staging`

Edit `.env.staging` and set at minimum:

```dotenv
# Application
NODE_ENV=production
APP_BASE_URL=https://<STAGING_DOMAIN>

# Database (use the POSTGRES_PASSWORD you generated)
POSTGRES_PASSWORD=<generated_hex_64>
DATABASE_URL="postgresql://str:<POSTGRES_PASSWORD>@postgres:5432/str_platform?schema=public"
DATABASE_SHADOW_URL="postgresql://str:<POSTGRES_PASSWORD>@postgres:5432/str_platform_shadow?schema=public"

# Auth (use the AUTH_SECRET you generated)
AUTH_SECRET=<generated_base64_32>
AUTH_TRUST_HOST=true

# i18n
NEXT_PUBLIC_DEFAULT_LOCALE=ar
NEXT_PUBLIC_LOCALES=ar,en

# Worker (set in worker container only — leave false here)
STR_WORKER=false
```

### 2.4 Verify the file is NOT committed

```bash
git status .env.staging
# Expected: nothing to commit, the file is gitignored
```

### 2.5 Mandatory env vars (fail-fast if missing)

The app WILL NOT START if any of these are missing or invalid
(validated by Zod in `src/lib/config.ts`):

- `DATABASE_URL` (must start with `postgresql://` or `postgres://`)
- `NODE_ENV` (must be `production` for staging)

The following are optional but recommended:

- `AUTH_SECRET` (required for auth features — without it, signup/signin will fail)
- `AUTH_TRUST_HOST` (defaults to `true` — set to `false` only behind a non-trusting proxy)
- `LOG_LEVEL` (defaults to `info`)
- `LOG_FORMAT` (defaults to `json` — do NOT use `pretty` in staging)

---

## 3. Production Image Build (mandatory)

### 3.1 Pull the latest main and verify SHA

```bash
git fetch origin main
git checkout main
git pull origin main
git log -1 --format='SHA: %H%nDate: %ci%nMessage: %s'
```

### 3.2 Build the image

```bash
docker build --target prod -t str-platform:staging .
```

This takes ~3–5 minutes on a 4 vCPU server. The build:

- Uses `oven/bun:1.3` as the base image.
- Copies `package.json` + `bun.lock` and runs `bun install --frozen-lockfile`.
- Generates Prisma client.
- Runs `bun run build` (Next.js standalone build).
- Copies `.next/standalone`, `.next/static`, `.next/server`, `public`,
  `prisma`, `src`, `tsconfig.json`, `package.json`, `bun.lock` into the
  prod image.
- Runs `bun install --production --frozen-lockfile` (prod deps only).

### 3.3 Verify the image

```bash
# List image
docker images str-platform:staging

# Smoke test: container starts and responds to /api/v1/health
docker run --rm -d --name str-staging-smoke \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://nonexistent:nonexistent@nonexistent:5432/nonexistent" \
  -e AUTH_SECRET="smoke-test-secret-16-chars" \
  -p 3001:3000 \
  str-platform:staging

# Wait for startup
sleep 5

# Health check (should return 200 even without a real DB — liveness)
curl -fsS http://localhost:3001/api/v1/health | jq .

# Readiness check (should return 503 — DB is unreachable)
curl -sS http://localhost:3001/api/v1/ready | jq .

# Cleanup
docker stop str-staging-smoke
```

If the smoke test fails, DO NOT proceed. The image is broken.

---

## 4. PostgreSQL Initialization (mandatory)

### 4.1 Start postgres only

```bash
docker compose -f docker-compose.staging.yml up -d postgres
```

### 4.2 Wait for healthcheck

```bash
# Wait until postgres is healthy
docker compose -f docker-compose.staging.yml exec postgres \
  pg_isready -U str -d str_platform

# Verify the data volume was created
docker volume inspect str-staging-pgdata
```

### 4.3 Verify no port is exposed externally

```bash
# This should show NO entry for 5432 in the host port mapping
docker port str-staging-postgres
# Expected output: (empty)
```

If `docker port` shows port 5432, the staging compose was modified
incorrectly. STOP and verify.

---

## 5. Migration Execution (mandatory, automated by compose)

### 5.1 Run the migrate service

```bash
docker compose -f docker-compose.staging.yml up migrate
```

This runs `bunx prisma migrate deploy` against the staging database.
Expected output (last lines):

```
Applying migration `20261017000000_g01_init`
Applying migration `20261017040000_g02_identity_profiles`
...
Applying migration `20261019040000_g07_integration_functional`

All migrations applied successfully.
```

If any migration fails:

- Check `docker compose -f docker-compose.staging.yml logs migrate` for details.
- DO NOT proceed to step 6.
- Common causes: wrong `DATABASE_URL`, postgres not healthy, conflicting
  schema state from a previous deployment.

### 5.2 Seed (optional, staging-only)

```bash
# Run inside the app container once it's up (after step 7)
# OR run it as a one-shot:
docker compose -f docker-compose.staging.yml run --rm app bun run db:seed
```

The seed creates:

- The `str.mock.v1` integration provider (registered, not enabled).
- The `application.test` capability on the mock provider.
- One admin user (synthetic — see `prisma/seed.ts` for credentials).

**DO NOT seed production.** Seed data is for staging verification only.

---

## 6. Web and Worker Startup (mandatory)

### 6.1 Start app + worker

```bash
docker compose -f docker-compose.staging.yml up -d app worker
```

The staging compose (post-G10-03 hardening) ensures:

- `migrate` runs BEFORE app/worker start (`depends_on: migrate: service_completed_successfully`).
- `postgres` is healthy BEFORE migrate runs.
- App has a Docker healthcheck hitting `/api/v1/health` every 15s.
- Worker has no HTTP healthcheck (no HTTP server) — monitor via logs.

### 6.2 Verify startup

```bash
# 1. Containers are running
docker compose -f docker-compose.staging.yml ps
# All three: postgres, app, worker should show "running" or "healthy"

# 2. App healthcheck passes
docker inspect --format='{{.State.Health.Status}}' str-staging-app
# Expected: "healthy" (may take ~30s after start)

# 3. Worker entered the polling loop
docker compose -f docker-compose.staging.yml logs --tail=10 worker
# Look for: {"level":"info","msg":"worker.entry.start",...}
# and: {"level":"info","msg":"outbox.worker.start",...}

# 4. App endpoints respond
curl -fsS http://localhost:3000/api/v1/health | jq .
curl -fsS http://localhost:3000/api/v1/ready | jq .
```

---

## 7. HTTPS and Reverse Proxy Configuration (mandatory)

### 7.1 Choose the proxy (MASTER decision)

`REQUIRES_MASTER_INPUT`: MASTER must choose ONE of:

- **Caddy** — single binary, automatic HTTPS via Let's Encrypt, simple
  config file. Recommended for single-domain staging.
- **Nginx Proxy Manager (NPM)** — web UI, multi-domain, good for teams
  that prefer GUI over config files.

### 7.2 Choose the proxy deployment topology (MASTER decision)

The reverse proxy can run in two places. The staging compose's default
port binding (`127.0.0.1:3000:3000`) supports topology #1 directly.
Topology #2 requires a one-line override documented below.

`REQUIRES_MASTER_INPUT`: MASTER must choose ONE topology.

#### Topology #1 — Proxy on the host (default)

The reverse proxy runs as a system service on the host (e.g., `caddy`
installed via apt, or NPM installed as a Docker container with
`network_mode: host`). The proxy connects to `127.0.0.1:3000` on the
host, which is the default binding in `docker-compose.staging.yml`.

- ✅ Default — no compose override needed.
- ✅ The app is NOT exposed publicly (only the proxy can reach it).
- ✅ The proxy terminates TLS, forwards plain HTTP to the app.
- ✅ Simple to operate — proxy and app are independent services.
- ⚠️ Requires the proxy to be installed as a system service (not in
  Docker) OR running with `network_mode: host`.

Verify the binding after starting the stack:

```bash
docker port str-staging-app
# Expected: 3000/tcp -> 127.0.0.1:3000
# NOT:       3000/tcp -> 0.0.0.0:3000 (that would be public)
```

#### Topology #2 — Proxy in a Docker container

The reverse proxy runs in its own Docker container on the same Docker
network as the STR stack. The proxy connects to the app by service name
(`app:3000`) over the internal Docker network. The app's `ports:` mapping
is removed entirely — only `expose: ["3000"]` is needed.

Create `docker-compose.proxy-override.yml`:

```yaml
# Override file for Topology #2 (proxy in Docker)
# Usage:
#   docker compose -f docker-compose.staging.yml \
#                  -f docker-compose.proxy-override.yml up -d
services:
  app:
    ports: !reset []
    expose:
      - "3000"
  # Optional: add the proxy service itself here, or run it separately.
```

Then run the stack with both files:

```bash
docker compose -f docker-compose.staging.yml \
               -f docker-compose.proxy-override.yml up -d
```

- ✅ No host port binding at all — the app is reachable only inside the
  Docker network.
- ✅ Cleaner isolation — no host process listens on 3000.
- ✅ Proxy and app share a Docker network and are managed together.
- ⚠️ Requires the proxy container to be on the same Docker network as
  the STR stack (Compose creates a default network per project; the
  proxy must join it).

### 7.3 Caddy configuration (Topology #1 — proxy on host)

`REQUIRES_MASTER_INPUT`: the staging domain name.

Create `/etc/caddy/Caddyfile` (or `~/Caddyfile` if running Caddy as root):

```caddyfile
<STAGING_DOMAIN> {
    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }

    # Security headers (also set by Next.js, but belt-and-braces at proxy)
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # Compress responses
    encode gzip zstd

    # Logging
    log {
        output file /var/log/caddy/<STAGING_DOMAIN>.log
        format json
    }
}
```

Start Caddy:

```bash
# Reload if already running
caddy reload --config /etc/caddy/Caddyfile

# Or start fresh
caddy start --config /etc/caddy/Caddyfile
```

Caddy automatically provisions a Let's Encrypt certificate on first request.

### 7.4 Caddy configuration (Topology #2 — proxy in Docker)

If running Caddy as a Docker container alongside the STR stack, use
`app:3000` as the upstream (not `127.0.0.1:3000`). Example
`docker-compose.caddy.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    container_name: str-staging-caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    # Joins the default network of the STR stack automatically
    # if you bring Caddy up in the same Compose project.

volumes:
  caddy_data:
  caddy_config:
```

Caddyfile:

```caddyfile
<STAGING_DOMAIN> {
    reverse_proxy app:3000 {
        header_up Host {host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
    # ... (security headers, encode, log — same as Topology #1)
}
```

Run both stacks together (Caddy joins the same default network):

```bash
docker compose -f docker-compose.staging.yml \
               -f docker-compose.proxy-override.yml \
               -f docker-compose.caddy.yml up -d
```

### 7.5 Nginx Proxy Manager configuration

`REQUIRES_MASTER_INPUT`: MASTER must provide NPM admin credentials and
confirm NPM is reachable on the staging server (typically ports 80, 81, 443).

NPM runs as a Docker container by default. If using Topology #1 (NPM
with `network_mode: host`), forward to `localhost:3000`. If using
Topology #2 (NPM on the same Docker network), forward to `app:3000`.

Via the NPM web UI (usually `http://<server-ip>:81`):

1. **SSL Certificates → Add SSL Certificate → Let's Encrypt**
   - Domain: `<STAGING_DOMAIN>`
   - Email: `REQUIRES_MASTER_INPUT`
   - Agree to TOS.

2. **Hosts → Proxy Hosts → Add Proxy Host**
   - Domain Names: `<STAGING_DOMAIN>`
   - Scheme: `http`
   - Forward Hostname / IP: `localhost` (Topology #1) or `app` (Topology #2)
   - Forward Port: `3000`
   - **Block Common Exploits**: enabled
   - **Websockets Support**: enabled.
   - **SSL** tab: select the Let's Encrypt cert from step 1.
     - Force SSL: ON
     - HTTP/2 Support: ON
     - HSTS: ON

### 7.6 Verify HTTPS

```bash
# DNS resolves to the server
dig +short <STAGING_DOMAIN>

# TLS cert is valid
curl -vI https://<STAGING_DOMAIN>/api/v1/health
# Look for: "SSL connection using TLSv1.3" and a valid cert chain.

# App responds over HTTPS
curl -fsS https://<STAGING_DOMAIN>/api/v1/health | jq .
curl -fsS https://<STAGING_DOMAIN>/api/v1/ready | jq .

# Verify the app is NOT directly reachable on port 3000 from outside
# (Topology #1 default binding is 127.0.0.1 only)
curl -vI http://<server-public-ip>:3000/api/v1/health
# Expected: connection refused or timeout (NOT HTTP 200)
```

If the last curl succeeds, the app is publicly exposed — STOP and
verify the port binding (`docker port str-staging-app` should show
`127.0.0.1:3000`, not `0.0.0.0:3000`).

---

## 8. Post-Deployment Smoke Tests (mandatory)

Run these AFTER step 7 completes (HTTPS is up):

### 8.1 Liveness and readiness

```bash
# Both should return 200
curl -fsS https://<STAGING_DOMAIN>/api/v1/health | jq .
curl -fsS https://<STAGING_DOMAIN>/api/v1/ready | jq .
```

### 8.2 App boots and serves HTML

```bash
# Home page returns 200 and contains expected markers
curl -fsS https://<STAGING_DOMAIN>/ | head -50 | grep -i "str\|syrian\|renaissance"
```

### 8.3 API smoke (unauthenticated endpoints)

```bash
# Public API endpoints (these vary by what G01-G09 implemented — check routes)
curl -fsS https://<STAGING_DOMAIN>/api/opportunities | jq .
curl -fsS https://<STAGING_DOMAIN>/api/talent | jq .
```

### 8.4 Auth flow (if AUTH_SECRET is set)

```bash
# Signup page is reachable
curl -fsSI https://<STAGING_DOMAIN>/ar/auth/signup
# Expected: 200 OK
```

### 8.5 Worker is processing

```bash
# Submit a test job via the integrations API (requires auth — skip in pure smoke)
# OR: check that the worker is alive and has no errors
docker compose -f docker-compose.staging.yml logs --tail=50 worker | grep -E "outbox\.worker\.start|outbox\.worker\.error"
# Expected: at least one "outbox.worker.start" and no "outbox.worker.error" entries
```

### 8.6 Database connectivity

```bash
# From inside the postgres container
docker compose -f docker-compose.staging.yml exec postgres \
  psql -U str -d str_platform -c "SELECT COUNT(*) FROM \"User\";"
# Expected: a number (0 if not seeded, 1 if seeded)
```

---

## 9. Rollback and Recovery Procedures (mandatory)

### 9.1 Rollback to a previous Git SHA

If the new deployment is broken:

```bash
# 1. Identify the last-known-good SHA
LAST_GOOD=<previous SHA>

# 2. Check out that SHA
git checkout $LAST_GOOD

# 3. Rebuild the image (or pull a previously-tagged image)
docker build --target prod -t str-platform:staging .

# 4. Stop app + worker
docker compose -f docker-compose.staging.yml stop app worker

# 5. If migrations were applied that are not present in $LAST_GOOD,
#    restore from a backup taken BEFORE the upgrade (see backup-restore.md §3.2).

# 6. Restart services
docker compose -f docker-compose.staging.yml up -d
```

### 9.2 Recovery from database corruption

See `backup-restore.md` §3.3 (restore into a fresh database).

### 9.3 Recovery from a worker stuck state

```bash
# If the worker is not processing jobs and logs show no errors:
docker compose -f docker-compose.staging.yml restart worker

# If that doesn't work, force recreate:
docker compose -f docker-compose.staging.yml up -d --force-recreate worker
```

### 9.4 Recovery from a postgres crash

```bash
# 1. Check postgres logs
docker compose -f docker-compose.staging.yml logs --tail=100 postgres

# 2. If the volume is intact, just restart:
docker compose -f docker-compose.staging.yml restart postgres

# 3. Wait for healthcheck to pass
docker compose -f docker-compose.staging.yml exec postgres pg_isready -U str -d str_platform

# 4. App and worker will recover automatically (readiness endpoint will
#    return 200 once postgres is back).
```

### 9.5 Full disaster recovery (server rebuild)

If the server is lost:

1. Provision a new server (§1).
2. Clone the repo, check out the last-known-good SHA.
3. Restore `.env.staging` from the secret backup (see `backup-restore.md` §5.4).
4. Build the image (§3).
5. Restore the database from the most recent backup (see `backup-restore.md` §3.3).
6. Configure the reverse proxy (§7).
7. Run smoke tests (§8).

---

## 10. Optional Integrations (require separate MASTER authorization)

These are NOT required for staging go-live. Each requires explicit
MASTER authorization before configuration.

### 10.1 S3 / Object Storage

Status: scaffolded (`src/modules/projects/file-evidence.ts`), NOT wired.

To enable:

1. MASTER provisions an S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, etc.).
2. MASTER provides credentials and adds them to `.env.staging`:
   ```dotenv
   S3_ENDPOINT=https://s3.<region>.amazonaws.com
   S3_REGION=<region>
   S3_BUCKET=<bucket-name>
   S3_ACCESS_KEY_ID=<access-key>
   S3_SECRET_ACCESS_KEY=<secret-key>
   S3_USE_PATH_STYLE=false  # true for MinIO, false for AWS S3
   ```
3. The `getFileReadUrl` function in `src/modules/projects/file-evidence.ts`
   must be updated to generate real signed URLs.
4. Restart the app: `docker compose -f docker-compose.staging.yml restart app`.

### 10.2 SMTP / Email Service

Status: scaffolded (`LogEmailService` is the default), NOT wired.

To enable:

1. MASTER provisions an SMTP provider (Postmark, SendGrid, AWS SES, etc.).
2. MASTER provides credentials and adds them to `.env.staging`:
   ```dotenv
   SMTP_HOST=smtp.postmarkapp.com
   SMTP_PORT=587
   SMTP_USER=<smtp-user>
   SMTP_PASSWORD=<smtp-password>
   SMTP_FROM=noreply@<staging-domain>
   ```
3. Implement `SmtpEmailService` (implements the `EmailService` interface
   in `src/modules/identity/email-service.ts`).
4. Update `getEmailService()` factory to return `SmtpEmailService` when
   `SMTP_HOST` is set.
5. Configure SPF, DKIM, and DMARC for the sending domain.
6. Restart the app: `docker compose -f docker-compose.staging.yml restart app`.

### 10.3 Google OAuth

Status: scaffolded (next-auth GoogleProvider configured in code), NOT wired.

To enable:

1. MASTER provisions a Google OAuth app in Google Cloud Console.
2. Configure authorized redirect URIs:
   `https://<STAGING_DOMAIN>/api/auth/callback/google`
3. MASTER provides credentials and adds them to `.env.staging`:
   ```dotenv
   GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<client-secret>
   ```
4. Rebuild the image (the `NEXT_PUBLIC_GOOGLE_ENABLED` flag is set at
   build time based on env vars — see `next.config.ts`):
   ```bash
   docker build --target prod -t str-platform:staging .
   docker compose -f docker-compose.staging.yml up -d app
   ```
5. Test the full Google sign-in + account linking flow in staging.
6. Verify safe linking: Google email collision with existing account
   must BLOCK (not auto-merge).

---

## 11. Mandatory vs Optional Summary

| Step | Mandatory for staging go-live? |
|------|-------------------------------|
| 1. Server prerequisites | YES |
| 2. `.env.staging` with `DATABASE_URL`, `POSTGRES_PASSWORD`, `AUTH_SECRET` | YES |
| 3. Production image build | YES |
| 4. PostgreSQL initialization | YES |
| 5. Migration execution (via `migrate` service) | YES |
| 6. Web + worker startup | YES |
| 7. HTTPS + reverse proxy (Caddy OR NPM) | YES |
| 8. Post-deployment smoke tests | YES |
| 9. Rollback and recovery procedures documented | YES |
| 10.1 S3 / Object Storage | NO (optional, MASTER-authorized) |
| 10.2 SMTP / Email Service | NO (optional, MASTER-authorized) |
| 10.3 Google OAuth | NO (optional, MASTER-authorized) |

---

## 12. Verification Status (G10-03-VALIDATION-01)

This runbook is **documented** as a procedure. The procedure itself
has NOT been empirically executed end-to-end on a real server. CI
empirically verifies the staging **compose file** (see
`.github/workflows/g10-03-staging-validation.yml`), but the procedure
of deploying to an actual server requires MASTER's server access.

### 12.1 What is empirically tested in CI

| Step | Tested? | CI workflow |
|------|---------|-------------|
| 4. PostgreSQL initialization (start + healthcheck) | TESTED | G10-02 integration CI + G10-03 staging validation CI (C1) |
| 5. Migration execution via `migrate` compose service | TESTED | G10-03 staging validation CI (C2) |
| 6. Web + worker startup (depends_on migrate) | TESTED | G10-03 staging validation CI (C3) |
| 6. App healthcheck reaches `healthy` | TESTED | G10-03 staging validation CI (C4) |
| 8. Readiness endpoint returns HTTP 200 | TESTED | G10-03 staging validation CI (C5) |
| 6. Worker enters polling loop | TESTED | G10-03 staging validation CI (C6) |
| 5. Failed migration blocks app/worker startup | TESTED | G10-03 staging validation CI (C7) |
| 7. App port bound to `127.0.0.1` only | TESTED | G10-03 staging validation CI (B1) |
| 4. Postgres NOT exposed to host | TESTED | G10-03 staging validation CI (B2) |

### 12.2 What is DOCUMENTED only (NOT empirically tested)

| Step | Status | Reason |
|------|--------|--------|
| 1. Server prerequisites | DOCUMENTED | Requires actual server. MASTER provides specs. |
| 2. `.env.staging` generation on real server | DOCUMENTED | CI uses synthetic credentials, not real ones. |
| 3. Production image build on real server | DOCUMENTED | CI builds the image; real server build is operator's responsibility. |
| 7. HTTPS + reverse proxy (Caddy OR NPM) | DOCUMENTED | Requires real domain + Let's Encrypt + DNS. |
| 8. Post-deployment smoke tests on real server | DOCUMENTED | CI runs smoke tests against `localhost:3000`; real server smoke requires HTTPS. |
| 9. Rollback and recovery procedures | DOCUMENTED | Per-failure-mode procedures documented; not all have been run end-to-end. |

### 12.3 Staging-only acceptance requirements

Before declaring staging "production-ready", these MUST be performed
on the actual staging server:

1. **End-to-end deployment** following §1–§8 of this runbook.
2. **Backup-and-restore round trip** (see `backup-restore.md` §12.3).
3. **Reverse proxy verification** — both that HTTPS works AND that
   the app is NOT directly reachable on port 3000 (§7.6).
4. **Migration rollback drill** — apply a new migration, take a backup,
   restore the pre-migration backup, verify the app starts cleanly.
5. **Worker graceful shutdown on the real server** — `docker compose
   stop worker`, verify exit 0 and `outbox.worker.shutdown.complete`
   log entry appears.
6. **Log inspection** — verify structured JSON logs are emitted, `reqId`
   correlation works, no secret leakage.

### 12.4 Production readiness requirements (do NOT block staging)

See `backup-restore.md` §12.4 for the full list. None block staging.
All MUST be resolved before production go-live.
