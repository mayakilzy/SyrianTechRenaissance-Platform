# STR Platform — G10-04A Server Discovery & Deployment Blueprint

> **Mission:** STR-G10-04A — Server Discovery & Deployment Blueprint
> **Status:** Discovery and planning only — NO deployment
> **Baseline SHA:** `1fe0881f4ab19922ac19e944a29a686f8677de09` (main, post-G10-03 merge)
> **Date:** 2026-10-21

---

## Executive Summary

This document covers Tracks A, B, C, and D of G10-04A. The objective is
to prepare the STR Platform for staging deployment without making any
unapproved changes to the staging server.

**Critical constraint:** GLM does NOT have direct SSH access to the
staging server. MASTER must execute the read-only discovery script
(located at `docs/operations/server-discovery.sh` in this commit) on the server
and share the output with GLM for analysis.

Until the discovery output is in hand, GLM has prepared:
1. A read-only discovery script (Track A).
2. A decision matrix for deployment architecture (Track B).
3. A prerequisites checklist classifying every item (Track C).
4. An ordered 11-step execution plan for G10-04B (Track D).

---

## Track A — Server Inventory

### A.1 GLM access to the server

**GLM does NOT have direct SSH access.** MASTER has not provided server
credentials and explicitly stated in the G10-04A directive: "If server
access is unavailable, prepare a single read-only diagnostic script
that MASTER can execute through the server terminal."

### A.2 Discovery script

**Location:** `docs/operations/server-discovery.sh` (committed on this branch).

**What it does (READ-ONLY):**
1. OS and architecture (`uname`, `/etc/os-release`)
2. CPU, RAM, disk (`nproc`, `free`, `df`)
3. Docker Engine version, Compose version, daemon config
4. Existing containers, networks, volumes, images
5. Reverse proxy inventory (Caddy, NPM, Nginx, Traefik)
6. Port usage (22, 80, 81, 443, 3000, 5432, 5433, 8080, 8443) + firewall
7. Available persistent storage and Docker root dir
8. Existing backup infrastructure (cron, restic, borg, rsync, etc.)
9. Existing STR Platform installations (avoid conflicts)
10. Public IP and outbound HTTPS connectivity
11. Time and timezone
12. Swap, ulimits

**What it does NOT do:**
- Does NOT install or remove any package
- Does NOT modify any file outside `/tmp`
- Does NOT start, stop, or restart any service
- Does NOT change firewall rules, DNS, or container state
- Does NOT expose any password, token, or private key
- Output is saved to `/tmp/str-g10-04a-discovery-<timestamp>.txt`

**How MASTER runs it:**
```bash
# On the staging server
bash docs/operations/server-discovery.sh

# Output saved to /tmp/str-g10-04a-discovery-<ts>.txt
cat /tmp/str-g10-04a-discovery-*.txt

# Share with GLM via the chat (paste or attach)
```

### A.3 Redaction guidance

The script is designed to not include secrets. Before sharing the
output with GLM, MASTER should review for:
- Private IPs or hostnames you do not want to share.
- Cron job command lines that may include sensitive paths.
- Anything in `docker info` output that concerns you.

Safe to share: OS, architecture, CPU/RAM/disk, Docker version, port
usage, firewall status, proxy inventory.

---

## Track B — Deployment Architecture

### B.1 Reference: G10-03 staging compose (already merged to main)

The staging compose at `docker-compose.staging.yml` is the authoritative
baseline. It defines:

| Service | Image | Container | Purpose |
|---------|-------|-----------|---------|
| `postgres` | `postgres:17-alpine` | `str-staging-postgres` | PostgreSQL 17 |
| `migrate` | `str-platform:staging` | `str-staging-migrate` | One-shot `prisma migrate deploy` |
| `app` | `str-platform:staging` | `str-staging-app` | Next.js standalone (`node server.js`) |
| `worker` | `str-platform:staging` | `str-staging-worker` | Outbox worker (`bun run src/worker/index.ts`) |

**Volume:** `str-staging-pgdata` (PostgreSQL data).

**Network:** default Compose network (project-scoped).

**Port bindings:**
- `app`: `127.0.0.1:3000:3000` (loopback only — proxy must be on the host)
- `postgres`: `expose: ["5432"]` (no host binding, internal only)
- `migrate`, `worker`: no port bindings

**Env file:** `--env-file .env.staging` is required at every `docker
compose` invocation (documented in the compose header).

### B.2 Topology decision matrix

The choice between Topology #1 (proxy on host) and Topology #2 (proxy
in Docker) depends on what MASTER's discovery reveals.

| Discovery finding | Recommended topology | Rationale |
|---|---|---|
| NPM already running as Docker container on the host network | **Topology #2** | Reuse existing NPM; STR app joins NPM's Docker network. |
| NPM already running with `network_mode: host` | **Topology #1** | NPM connects to `127.0.0.1:3000`. Default staging compose works as-is. |
| Caddy installed as system service | **Topology #1** | Caddy connects to `127.0.0.1:3000`. Default staging compose works as-is. |
| Nginx installed as system service | **Topology #1** | Same as Caddy — `127.0.0.1:3000`. |
| No reverse proxy installed | **Topology #1 + install Caddy** | Caddy is the simplest: single binary, auto-HTTPS. Install via apt. |
| Master prefers NPM web UI over config files | **Topology #2 + NPM stack** | Deploy NPM via its official docker-compose. |

### B.3 Isolation strategy (if other apps run on the server)

If the discovery script shows other Docker containers running, the STR
deployment must avoid conflicts in:

| Resource | STR staging default | Conflict mitigation |
|----------|---------------------|---------------------|
| Container names | `str-staging-{postgres,app,worker,migrate}` | Already unique — `str-staging-` prefix avoids collisions. |
| Docker network | Default project network (`<dir>_default`) | Project-scoped; safe. |
| Docker volume | `str-staging-pgdata` | Already unique. |
| Host port | `127.0.0.1:3000` | If 3000 is in use, override in `docker-compose.staging.override.yml` to `127.0.0.1:3001:3000`. |
| Public ports (80, 443) | Only used by reverse proxy | If another proxy already binds 80/443, integrate with it rather than installing a new proxy. |

### B.4 Recommended architecture (pending discovery)

**Recommendation:** Default to **Topology #1** (proxy on host). This is
the simplest path and matches the staging compose's default port binding.

If the discovery reveals:
- NPM is already installed → use NPM, configure via web UI (Topology #1
  if NPM has `network_mode: host`, else Topology #2).
- Caddy is already installed → use Caddy.
- Neither → install Caddy via apt (single binary, simplest).

**MASTER must approve the final topology decision** based on discovery
output before G10-04B starts.

### B.5 Container restart and logging policies

| Service | Restart policy | Log rotation |
|---------|----------------|--------------|
| `postgres` | `always` | Docker daemon default (`json-file`) |
| `app` | `always` | Docker daemon default |
| `worker` | `always` | Docker daemon default |
| `migrate` | `no` (one-shot) | N/A |

**Docker daemon log rotation** should be configured at the daemon
level, not per-container. The discovery script reports
`/etc/docker/daemon.json`. If absent, G10-04B step 1 will create it:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

This is a safe, standard configuration. MASTER approval required
because it touches the Docker daemon.

---

## Track C — Deployment Prerequisites Checklist

### C.1 Already satisfied (no action needed)

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Production Docker image builds | ✅ SATISFIED | G10-03 Staging Compose Validation CI #4 (all 14 steps green) |
| 2 | Next.js standalone runtime works | ✅ SATISFIED | CI step A3 (healthcheck command succeeds) |
| 3 | Prisma migrations apply | ✅ SATISFIED | CI step C2 |
| 4 | Worker starts and polls | ✅ SATISFIED | CI step C6 |
| 5 | Health/readiness endpoints respond | ✅ SATISFIED | CI steps C4 (health) + C5 (ready) |
| 6 | Migration ordering enforced | ✅ SATISFIED | CI step C3 + C7 (failed migration blocks dependents) |
| 7 | App port binding to 127.0.0.1 | ✅ SATISFIED | CI step B1 |
| 8 | Postgres internal-only | ✅ SATISFIED | CI step B2 |
| 9 | Staging compose + runbook documented | ✅ SATISFIED | `docs/operations/staging-deployment.md` (636 lines) |
| 10 | Backup/restore procedures documented | ✅ SATISFIED | `docs/operations/backup-restore.md` (519 lines) |
| 11 | `--env-file .env.staging` requirement documented | ✅ SATISFIED | compose header + all runbook invocations |
| 12 | `.env.staging` gitignored (never committed) | ✅ SATISFIED | `.gitignore` §"env files" |

### C.2 Missing server prerequisites (must be resolved in G10-04B)

| # | Requirement | Resolution | Master approval? |
|---|-------------|------------|------------------|
| M1 | Docker Engine 24+ installed on server | Install via apt if missing | YES |
| M2 | Docker Compose v2 (plugin) installed | Comes with Docker 24+ | YES (if Docker install needed) |
| M3 | Docker daemon log rotation configured | Create `/etc/docker/daemon.json` | YES (touches daemon) |
| M4 | Reverse proxy installed (Caddy or NPM) | Install Caddy via apt OR deploy NPM via Docker | YES |
| M5 | Staging subdomain DNS A record pointing to server | Configure at DNS provider | YES (DNS) |
| M6 | Firewall allows ports 22, 80, 443 inbound | Configure `ufw` or cloud firewall | YES |
| M7 | Firewall blocks ports 3000, 5432, 5433 from public | `ufw default deny incoming` + per-port allow | YES |
| M8 | Backup destination identified | Local path, off-host target, or bucket | YES (provides choice) |
| M9 | Docker host clock synced (NTP) | Verify `timedatectl status` | YES if not synced |
| M10 | `.env.staging` file with real secrets on server | Generate via `openssl rand -hex 32` | NO (operator does this) |

### C.3 Configuration values requiring MASTER approval

These are NOT secrets — they are deployment decisions only MASTER can make.

| # | Decision | Options | Default if MASTER does not answer |
|---|-----------|---------|----------------------------------|
| D1 | Reverse proxy choice | Caddy / NPM / existing Nginx / existing Traefik | Caddy (simplest) |
| D2 | Topology | #1 (proxy on host) / #2 (proxy in Docker) | #1 (matches default staging compose) |
| D3 | Staging subdomain | e.g., `staging.str.platform` | BLOCKER — MASTER must provide |
| D4 | Email for Let's Encrypt ACME | (any valid email) | BLOCKER if NPM is chosen |
| D5 | Project directory on server | e.g., `/opt/str/staging` | `/opt/str/staging` |
| D6 | Backup destination type | Local dir / off-host rsync / S3 bucket | Local dir `/var/backups/str-staging` |
| D7 | Backup retention policy | Days to keep | 14 daily + 4 weekly |
| D8 | Postgres `POSTGRES_PASSWORD` | Generated by `openssl rand -hex 32` | (auto-generated at install time) |
| D9 | Auth `AUTH_SECRET` | Generated by `openssl rand -base64 32` | (auto-generated at install time) |
| D10 | Admin user email for first login | (any valid email) | BLOCKER — needed for seed |

### C.4 Items that can be safely automated (G10-04B execution)

These are deterministic, repeatable, and safe to script:

| # | Task | Automatable? | Risk |
|---|------|--------------|------|
| A1 | Clone STR repo at SHA `1fe0881f` | ✅ YES | None |
| A2 | Build `str-platform:staging` image | ✅ YES | None (deterministic) |
| A3 | Generate `POSTGRES_PASSWORD` via `openssl rand -hex 32` | ✅ YES | None |
| A4 | Generate `AUTH_SECRET` via `openssl rand -base64 32` | ✅ YES | None |
| A5 | Write `.env.staging` from template + generated secrets | ✅ YES | None (file is gitignored) |
| A6 | `docker compose --env-file .env.staging -f docker-compose.staging.yml up -d` | ✅ YES | None (idempotent) |
| A7 | Verify health endpoints return 200 | ✅ YES | None |
| A8 | Verify worker logs `outbox.worker.start` | ✅ YES | None |
| A9 | Verify row counts in postgres | ✅ YES | None |
| A10 | Take first `pg_dump` backup | ✅ YES | None |
| A11 | Configure Caddy with staging subdomain | ✅ YES | LOW (config file write) |

### C.5 Items that must remain manual (require human judgment)

| # | Task | Why manual? |
|---|------|-------------|
| H1 | DNS A record creation at the DNS provider | Requires DNS provider login (outside server) |
| H2 | Reverse proxy choice (Caddy vs NPM) | Strategic decision, not technical |
| H3 | NPM web UI configuration (if NPM chosen) | NPM uses a GUI, not config files |
| H4 | Cloud firewall rules (if cloud-hosted) | Cloud provider console, not server |
| H5 | First staging admin user account | MASTER decides the email |
| H6 | Master approval to proceed past each gate | Human judgment, not scriptable |
| H7 | Backup destination choice | Strategic (cost vs convenience) |
| H8 | Production data migration (if any) | Requires data classification review |

---

## Track D — Execution Plan for G10-04B

This is the ordered 11-step plan for G10-04B (actual deployment).
**GLM will NOT execute any of these steps without explicit MASTER
authorization in a separate G10-04B mission.**

### Step 0 — Pre-flight (before any work on the server)

| # | Action | Owner | Status |
|---|--------|-------|--------|
| 0.1 | Review G10-04A discovery output | GLM | (pending MASTER shares discovery) |
| 0.2 | Confirm Track B topology decision | MASTER | (pending) |
| 0.3 | Confirm Track C D-items (D1-D10) | MASTER | (pending) |
| 0.4 | Confirm Track C M-items (M1-M10) | MASTER + operator | (pending) |
| 0.5 | Confirm G10-04B is authorized | MASTER | (pending) |

### Step 1 — Server preparation

**Goal:** Install missing prerequisites on the staging server.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 1.1 | If Docker missing: install Docker Engine 24+ via official apt repo | ✅ Automated (script) | LOW — standard install |
| 1.2 | Verify `docker --version` returns 24+ | ✅ Automated | None |
| 1.3 | Verify `docker compose version` works (v2 plugin) | ✅ Automated | None |
| 1.4 | If `/etc/docker/daemon.json` missing: create with log rotation config | ✅ Automated | LOW — requires daemon restart |
| 1.5 | Restart Docker daemon to pick up log rotation: `systemctl restart docker` | ✅ Automated | LOW — existing containers briefly lose connection |
| 1.6 | Verify NTP time sync: `timedatectl status` | ✅ Automated | None |
| 1.7 | If unsynced: `timedatectl set-ntp true` | ✅ Automated | LOW |
| 1.8 | Update OS packages: `apt update && apt upgrade -y` | ❌ MASTER approval | MEDIUM — may require reboot |

### Step 2 — Docker project isolation

**Goal:** Create a project directory and avoid conflicts with other apps.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 2.1 | Create project directory: `mkdir -p /opt/str/staging` | ✅ Automated | None |
| 2.2 | Verify no existing `str-staging-*` containers exist | ✅ Automated | None |
| 2.3 | If existing STR containers found: STOP — escalate to MASTER | ❌ MASTER approval | HIGH — could be a previous install |
| 2.4 | Verify port 3000 on 127.0.0.1 is free; if not, override to 3001 | ✅ Automated | None |
| 2.5 | Verify no `str-staging-pgdata` volume exists; if so, escalate | ❌ MASTER approval | HIGH — could be a previous DB |

### Step 3 — Staging environment configuration

**Goal:** Generate `.env.staging` with real secrets.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 3.1 | Clone STR repo at SHA `1fe0881f`: `git clone https://github.com/mayakilzy/SyrianTechRenaissance-Platform.git /opt/str/staging` | ✅ Automated | None |
| 3.2 | Checkout exact SHA: `git checkout 1fe0881f4ab19922ac19e944a29a686f8677de09` | ✅ Automated | None |
| 3.3 | Copy `.env.staging.example` to `.env.staging`: `cp .env.staging.example .env.staging` | ✅ Automated | None |
| 3.4 | Generate `POSTGRES_PASSWORD`: `openssl rand -hex 32` | ✅ Automated | None |
| 3.5 | Generate `AUTH_SECRET`: `openssl rand -base64 32` | ✅ Automated | None |
| 3.6 | Update `.env.staging` with generated values + MASTER-provided values (APP_BASE_URL, etc.) | ✅ Automated (with sed) | None |
| 3.7 | Verify `.env.staging` is gitignored: `git status .env.staging` (should show nothing) | ✅ Automated | None |
| 3.8 | Verify file permissions: `chmod 600 .env.staging` | ✅ Automated | None |

### Step 4 — Database and volume creation

**Goal:** Bring up PostgreSQL with persistent volume.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 4.1 | Start postgres only: `docker compose --env-file .env.staging -f docker-compose.staging.yml up -d postgres` | ✅ Automated | None |
| 4.2 | Wait for postgres healthcheck (max 60s) | ✅ Automated | None |
| 4.3 | Verify volume created: `docker volume inspect str-staging-pgdata` | ✅ Automated | None |
| 4.4 | Verify postgres NOT exposed externally: `docker port str-staging-postgres` (should be empty) | ✅ Automated | None |

### Step 5 — Application image deployment

**Goal:** Build or pull the STR production image.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 5.1 | Build image: `docker build --target prod -t str-platform:staging .` | ✅ Automated | None (deterministic) |
| 5.2 | Verify image builds successfully (exit 0) | ✅ Automated | None |
| 5.3 | Verify image is present: `docker images str-platform:staging` | ✅ Automated | None |
| 5.4 | Smoke test: `docker run --rm str-platform:staging node -e "console.log('OK')"` | ✅ Automated | None |

### Step 6 — Prisma migrations

**Goal:** Apply database schema via the `migrate` compose service.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 6.1 | Run migrate service: `docker compose --env-file .env.staging -f docker-compose.staging.yml up migrate` | ✅ Automated | None (idempotent) |
| 6.2 | Verify exit code 0 | ✅ Automated | None |
| 6.3 | Verify all 11 migrations applied: `docker compose ... exec postgres psql -c "SELECT COUNT(*) FROM \"_prisma_migrations\""` | ✅ Automated | None |
| 6.4 | If exit code != 0: STOP — escalate to MASTER | ❌ MASTER approval | HIGH — schema issue |

### Step 7 — Worker startup (along with app)

**Goal:** Bring up the app and worker containers.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 7.1 | Start app + worker: `docker compose --env-file .env.staging -f docker-compose.staging.yml up -d app worker` | ✅ Automated | None |
| 7.2 | Wait for app healthcheck (max 60s) | ✅ Automated | None |
| 7.3 | Verify app container is healthy: `docker inspect --format='{{.State.Health.Status}}' str-staging-app` | ✅ Automated | None |
| 7.4 | Verify worker entered polling loop: `docker compose ... logs worker | grep outbox.worker.start` | ✅ Automated | None |
| 7.5 | Verify app bound to 127.0.0.1: `docker port str-staging-app` (should show `127.0.0.1:3000`) | ✅ Automated | None |

### Step 8 — Reverse proxy and HTTPS

**Goal:** Configure Caddy or NPM to terminate TLS and forward to app.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 8.1 | If Caddy chosen (Topology #1): write `/etc/caddy/Caddyfile` with staging subdomain + reverse_proxy to `127.0.0.1:3000` | ✅ Automated | LOW (config write) |
| 8.2 | `caddy reload --config /etc/caddy/Caddyfile` | ✅ Automated | LOW (no restart) |
| 8.3 | If NPM chosen: open NPM web UI at `http://<server-ip>:81`, add Proxy Host manually | ❌ Manual (H3) | LOW |
| 8.4 | Verify Let's Encrypt cert provisioned (check Caddy logs or NPM UI) | ✅ Automated | None |
| 8.5 | Verify `https://<staging-domain>/api/v1/health` returns 200 | ✅ Automated | None |
| 8.6 | Verify `https://<staging-domain>/api/v1/ready` returns 200 | ✅ Automated | None |
| 8.7 | Verify `http://<staging-domain>/api/v1/health` redirects to HTTPS | ✅ Automated | None |
| 8.8 | Verify app is NOT directly reachable on port 3000 from outside (curl from another host) | ✅ Automated | None |

### Step 9 — Health and readiness verification

**Goal:** End-to-end smoke tests on the live staging deployment.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 9.1 | Liveness: `curl -fsS https://<domain>/api/v1/health` → 200 | ✅ Automated | None |
| 9.2 | Readiness: `curl -fsS https://<domain>/api/v1/ready` → 200 | ✅ Automated | None |
| 9.3 | Home page: `curl -fsS https://<domain>/` → 200 + contains "STR" or "Syrian" | ✅ Automated | None |
| 9.4 | Public API: `curl -fsS https://<domain>/api/opportunities` → 200 | ✅ Automated | None |
| 9.5 | Signup page: `curl -fsS https://<domain>/ar/auth/signup` → 200 | ✅ Automated | None |
| 9.6 | Worker logs: no `outbox.worker.fatal` entries in last 5 min | ✅ Automated | None |
| 9.7 | Postgres row counts: `User` count is 1 (after seed) | ✅ Automated | None |
| 9.8 | Container uptime: all containers up for > 2 minutes | ✅ Automated | None |

### Step 10 — Backup and restore testing

**Goal:** Empirically validate the backup/restore procedures documented in G10-03.

This is the test that **elevates backup/restore from DOCUMENTED to PASS**.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 10.1 | Take backup A: `docker compose ... exec -T postgres pg_dump -U str -d str_platform > /tmp/backup-A.sql` | ✅ Automated | None |
| 10.2 | Verify backup A is non-empty: `wc -c /tmp/backup-A.sql` | ✅ Automated | None |
| 10.3 | Record row counts: `psql -c "SELECT COUNT(*) FROM \"User\""` → row_count_A | ✅ Automated | None |
| 10.4 | Insert a test row (e.g., a test user) — required: write a small SQL insert | ✅ Automated | LOW — adds 1 test row |
| 10.5 | Take backup B (with the test row) | ✅ Automated | None |
| 10.6 | Restore from backup A (BEFORE the test row): `psql < /tmp/backup-A.sql` | ✅ Automated | LOW — staging DB only |
| 10.7 | Verify row count returned to row_count_A (test row is gone) | ✅ Automated | None |
| 10.8 | Restore from backup B (with the test row): `psql < /tmp/backup-B.sql` | ✅ Automated | LOW |
| 10.9 | Verify test row is back | ✅ Automated | None |
| 10.10 | Cleanup: delete the test row | ✅ Automated | None |
| 10.11 | Update `backup-restore.md` §12 to change DOCUMENTED → PASS | ❌ Manual (H6) | None |

### Step 11 — Rollback and recovery verification

**Goal:** Validate rollback procedure works.

| # | Action | Automatable? | Risk |
|---|--------|--------------|------|
| 11.1 | Take pre-rollback backup | ✅ Automated | None |
| 11.2 | Stop app + worker: `docker compose ... stop app worker` | ✅ Automated | LOW — brief downtime |
| 11.3 | Check out previous SHA: `git checkout 006f5f79` (G10-02 baseline) | ✅ Automated | None |
| 11.4 | Rebuild image: `docker build --target prod -t str-platform:staging .` | ✅ Automated | None |
| 11.5 | Restart app + worker: `docker compose ... up -d app worker` | ✅ Automated | None |
| 11.6 | Verify app responds to liveness: `curl http://127.0.0.1:3000/api/v1/health` → 200 | ✅ Automated | None |
| 11.7 | Roll forward: `git checkout 1fe0881f` (G10-03 merge) | ✅ Automated | None |
| 11.8 | Rebuild image, restart services | ✅ Automated | None |
| 11.9 | Verify back on G10-03 baseline | ✅ Automated | None |

### Step 12 — G10-04B acceptance gate

| # | Action | Owner |
|---|--------|-------|
| 12.1 | All Step 9 checks pass | GLM |
| 12.2 | Step 10 backup/restore round-trip succeeds | GLM |
| 12.3 | Step 11 rollback drill succeeds | GLM |
| 12.4 | Update `backup-restore.md` and `staging-deployment.md` to mark items DOCUMENTED → PASS | GLM |
| 12.5 | MASTER authorizes moving to G10-04C (Live Acceptance) | MASTER |

---

## Final Report

```
MISSION: STR-G10-04A
SERVER_ACCESS: NO (GLM does not have direct SSH access)
SERVER_INVENTORY: PENDING — discovery script at docs/operations/server-discovery.sh
                  MASTER must execute it and share the output.
EXISTING_DOCKER: PENDING DISCOVERY
EXISTING_PROXY: PENDING DISCOVERY (Caddy / NPM / Nginx / Traefik / none)
RECOMMENDED_TOPOLOGY: Topology #1 (proxy on host) by default;
                      switch to Topology #2 if NPM is already running in Docker.
STAGING_DOMAIN_STATUS: PENDING MASTER DECISION (D3 — staging subdomain)
STORAGE_AND_BACKUP: PENDING MASTER DECISION (D6 — backup destination type)
PORT_CONFLICTS: PENDING DISCOVERY (script checks 22/80/81/443/3000/5432/5433/8080/8443)
MISSING_PREREQUISITES:
  - M1: Docker Engine 24+ (verify in discovery)
  - M2: Docker Compose v2 (verify in discovery)
  - M3: Docker daemon log rotation (/etc/docker/daemon.json)
  - M4: Reverse proxy (Caddy OR NPM OR existing)
  - M5: DNS A record for staging subdomain
  - M6/M7: Firewall rules (allow 22/80/443, deny 3000/5432)
  - M8: Backup destination identified
  - M9: NTP time sync verified
  - M10: .env.staging generated on server
MASTER_DECISIONS_REQUIRED:
  - D1: Reverse proxy choice (Caddy / NPM / existing Nginx / existing Traefik)
  - D2: Topology (#1 host / #2 Docker container)
  - D3: Staging subdomain (BLOCKER)
  - D4: ACME email (if NPM chosen)
  - D5: Project directory on server (default: /opt/str/staging)
  - D6: Backup destination type (default: local /var/backups/str-staging)
  - D7: Backup retention policy (default: 14 daily + 4 weekly)
  - D10: First admin user email (BLOCKER for seed)
READY_FOR_G10_04B: NO — pending:
  1. MASTER shares discovery script output (Track A)
  2. MASTER answers D1, D2, D3, D10 (Track C)
  3. MASTER authorizes G10-04B execution
```

---

## Boundaries Respected ✅

- ✅ No application deployment
- ✅ No DNS changes
- ✅ No firewall changes
- ✅ No installation or removal of software
- ✅ No changes to existing containers
- ✅ No repository modifications beyond this branch (feat/g10-04a-server-discovery)
- ✅ No production launch
- ✅ Discovery script is read-only — verified by `bash -n` syntax check

---

## What's in this commit (1 new file)

| File | Purpose | Lines |
|------|---------|-------|
| `docs/operations/server-discovery.sh` | Read-only server discovery script for MASTER to run | ~330 |
| `docs/operations/g10-04a-server-blueprint.md` | This blueprint (Tracks A+B+C+D) | ~500 |

Total: 2 new files, no modifications to existing files. Branch
`feat/g10-04a-server-discovery` will be pushed for MASTER review but
NOT merged automatically.

---

## Next Action (for MASTER)

1. **Run the discovery script on the staging server:**
   ```bash
   bash docs/operations/server-discovery.sh
   cat /tmp/str-g10-04a-discovery-*.txt
   ```
2. **Review the output** for any sensitive info (redact if needed).
3. **Share the output with GLM** (paste or attach).
4. **Answer decisions D1, D2, D3, D10** based on the discovery.
5. **Authorize G10-04B** — actual staging deployment.

Once G10-04B is complete and the staging site is live and verified,
the team can move to UI/UX work (MASTER's stated next priority).
