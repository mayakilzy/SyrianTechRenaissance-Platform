#!/usr/bin/env bash
# ============================================================
# STR Platform — Server Discovery Script (G10-04A Track A)
# ------------------------------------------------------------
# READ-ONLY diagnostic script. MASTER executes this on the
# staging server; GLM analyses the output.
#
# G10-04A-FIX-01 hardening (per MASTER review):
#   - Never prints full /etc/docker/daemon.json — only extracts
#     non-sensitive fields (log-driver, log-opts max-size/max-file,
#     storage-driver, dns, bip). All other fields are masked.
#   - Never prints Cron command lines — reports only the count of
#     non-comment, non-empty entries per cron source, plus the
#     presence of backup-related binaries.
#   - Never prints the full public IP — only the first two octets
#     (e.g., 203.0.x.x) to identify the network class. MASTER can
#     opt in to the full IP via STR_REVEAL_PUBLIC_IP=1 if needed.
#   - Never prints listening-socket process names (which can include
#     user-supplied arguments). Only reports port + protocol + bound
#     address family.
#   - Explicitly avoids writing anywhere outside /tmp.
#
# THIS SCRIPT DOES NOT:
#   - Install anything
#   - Remove anything
#   - Modify any file outside /tmp
#   - Start or stop any service
#   - Change firewall rules
#   - Change DNS
#   - Change container state
#   - Print any secret, password, token, private key, or full
#     command-line arguments from cron / process tables
#
# Output: structured report saved to /tmp/str-g10-04a-discovery-<ts>.txt
# Print the file contents and share with GLM after redaction review.
# ============================================================

set -uo pipefail  # NO -e: we want to continue even if a probe fails

OUTPUT_FILE="/tmp/str-g10-04a-discovery-$(date -u +%Y%m%dT%H%M%SZ).txt"

# Allow MASTER to opt in to revealing the full public IP (default: masked).
# Usage: STR_REVEAL_PUBLIC_IP=1 bash docs/operations/server-discovery.sh
REVEAL_PUBLIC_IP="${STR_REVEAL_PUBLIC_IP:-0}"

# Allow MASTER to opt in to revealing process names in `ss` output (default: hidden).
# Usage: STR_REVEAL_PROCESS_NAMES=1 bash docs/operations/server-discovery.sh
REVEAL_PROCESS_NAMES="${STR_REVEAL_PROCESS_NAMES:-0}"

{
echo "============================================================"
echo "STR Platform — Server Discovery Report"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Hostname:  $(hostname 2>/dev/null || echo unknown)"
echo "============================================================"
echo ""

# -------- 1. Operating system and architecture --------
echo "## 1. Operating System and Architecture"
echo ""
echo "uname -a:"
uname -a 2>/dev/null || echo "  (uname not available)"
echo ""
echo "/etc/os-release:"
if [ -f /etc/os-release ]; then
    grep -E "^(NAME|VERSION|PRETTY_NAME|ID|VERSION_ID|VERSION_CODENAME)=" /etc/os-release | sed 's/^/  /' || echo "  (no fields matched)"
else
    echo "  (no /etc/os-release)"
fi
echo ""
echo "Architecture:"
echo "  uname -m: $(uname -m 2>/dev/null || echo unknown)"
if command -v dpkg >/dev/null 2>&1; then
    echo "  dpkg arch: $(dpkg --print-architecture 2>/dev/null)"
fi
echo ""

# -------- 2. CPU, RAM, disk --------
echo "## 2. CPU, RAM, Disk"
echo ""
echo "CPU:"
echo "  nproc:      $(nproc 2>/dev/null || echo unknown)"
echo "  model name: $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ //')"
echo ""
echo "Memory:"
if command -v free >/dev/null 2>&1; then
    free -h | sed 's/^/  /'
else
    echo "  MemTotal: $(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2 " kB"}')"
fi
echo ""
echo "Disk usage (real filesystems only):"
if command -v df >/dev/null 2>&1; then
    df -hT 2>/dev/null | grep -vE '^(tmpfs|devtmpfs|overlay)' | sed 's/^/  /' || echo "  (could not list)"
else
    echo "  (df not available)"
fi
echo ""

# -------- 3. Docker and Docker Compose --------
echo "## 3. Docker and Docker Compose"
echo ""
echo "Docker Engine:"
if command -v docker >/dev/null 2>&1; then
    echo "  docker version: $(docker --version 2>&1)"
    echo "  docker path:    $(command -v docker)"
    echo ""
    echo "  Server info (subset):"
    docker info 2>/dev/null \
        | grep -E "^(Server Version|Operating System|Total Memory|CPUs|Storage Driver|Docker Root Dir|Kernel Version|Architecture|OSType):" \
        | sed 's/^/    /' || echo "    (could not get docker info — daemon may not be running)"
    echo ""
    echo "  Daemon config (/etc/docker/daemon.json) — non-sensitive fields only:"
    if [ -f /etc/docker/daemon.json ]; then
        # G10-04A-FIX-01: do NOT print the full daemon.json. It may contain
        # private registry mirrors, insecure-registries with internal hostnames,
        # live-restore settings tied to a private etcd endpoint, or other
        # sensitive values. Extract ONLY the fields relevant to STR staging:
        #   - log-driver, log-opts (max-size, max-file)
        #   - storage-driver
        #   - dns, bip (networking — useful for compose network planning)
        #   - live-restore, iptables, userland-proxy, default-runtime
        #   - Whether the file exists at all (so MASTER knows it needs creating)
        # All other fields are reported as "(present, value redacted)".
        if command -v python3 >/dev/null 2>&1; then
            # Use python3 to parse JSON properly. Read the file directly inside
            # python (not via stdin redirect — heredoc already occupies stdin).
            python3 -c '
import json
ALLOWED = {
    "log-driver", "log-opts", "storage-driver", "dns", "bip",
    "live-restore", "iptables", "userland-proxy", "default-runtime",
}
try:
    with open("/etc/docker/daemon.json") as f:
        cfg = json.load(f)
except Exception as e:
    print("    (file exists but could not be parsed as JSON: %s)" % e)
    raise SystemExit(0)
for key in sorted(cfg.keys()):
    if key in ALLOWED:
        print("    %s: %s" % (key, json.dumps(cfg[key])))
    else:
        print("    %s: (present, value redacted)" % key)
'
        else
            # Fallback if python3 is not available: grep for known-safe keys only
            grep -E '^\s*"(log-driver|log-opts|storage-driver|dns|bip|live-restore|iptables|userland-proxy|default-runtime)' /etc/docker/daemon.json 2>/dev/null | sed 's/^/    /' || echo "    (no recognized safe fields; file may contain custom config — review manually)"
            echo "    (other fields redacted; install python3 for a full filtered view)"
        fi
    else
        echo "    (no /etc/docker/daemon.json — default log driver, no log rotation configured)"
    fi
else
    echo "  docker: NOT INSTALLED"
fi
echo ""
echo "Docker Compose:"
if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
        echo "  docker compose version: $(docker compose version 2>&1)"
        echo "  (compose v2 — plugin form, supported by STR staging)"
    else
        echo "  docker compose (v2 plugin): NOT AVAILABLE — STR staging requires v2"
    fi
fi
if command -v docker-compose >/dev/null 2>&1; then
    echo "  docker-compose (legacy v1): $(docker-compose --version 2>&1)"
    echo "  WARNING: legacy v1 — STR staging compose uses v2-only syntax"
fi
echo ""

# -------- 4. Existing containers and networks --------
echo "## 4. Existing Docker Containers and Networks"
echo ""
if command -v docker >/dev/null 2>&1; then
    echo "Running containers:"
    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list)"
    echo ""
    echo "All containers (running + stopped):"
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list)"
    echo ""
    echo "Docker networks:"
    docker network ls 2>/dev/null | head -20 | sed 's/^/  /' || echo "  (could not list)"
    echo ""
    echo "Docker volumes:"
    docker volume ls 2>/dev/null | head -20 | sed 's/^/  /' || echo "  (could not list)"
    echo ""
    echo "Docker images (top 20):"
    docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' 2>/dev/null | head -20 | sed 's/^/  /' || echo "  (could not list)"
else
    echo "  Docker not installed — skipping container/network/volume/image inventory"
fi
echo ""

# -------- 5. Reverse proxies --------
echo "## 5. Reverse Proxy Inventory"
echo ""
echo "Caddy (on host):"
if command -v caddy >/dev/null 2>&1; then
    echo "  caddy version: $(caddy version 2>&1)"
    echo "  caddy path:    $(command -v caddy)"
    echo "  systemd service status (first 5 lines):"
    systemctl status caddy --no-pager 2>&1 | head -5 | sed 's/^/    /' || echo "    (no systemd or no caddy service)"
    echo "  Caddyfile locations:"
    for f in /etc/caddy/Caddyfile /etc/caddy/caddy.json; do
        [ -f "$f" ] && echo "    found: $f"
    done
else
    echo "  caddy: NOT INSTALLED on host"
fi
echo ""
echo "Nginx Proxy Manager (NPM) — typically runs as Docker container:"
if command -v docker >/dev/null 2>&1; then
    echo "  NPM-style containers (by name or image):"
    if docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null \
        | grep -iE 'nginx-proxy-manager|npm-|jc21'; then
        :
    else
        echo "    (no NPM-style containers found)"
    fi
    echo ""
    echo "  NPM-style images:"
    if docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | grep -iE 'nginx-proxy-manager|npm|jc21'; then
        :
    else
        echo "    (no NPM-style images found)"
    fi
fi
echo ""
echo "Plain Nginx (on host):"
if command -v nginx >/dev/null 2>&1; then
    echo "  nginx version: $(nginx -v 2>&1)"
    echo "  nginx path:    $(command -v nginx)"
    echo "  systemd service status (first 5 lines):"
    systemctl status nginx --no-pager 2>&1 | head -5 | sed 's/^/    /' || echo "    (no systemd or no nginx service)"
else
    echo "  nginx: NOT INSTALLED on host"
fi
echo ""
echo "Traefik (typically Docker container):"
if command -v docker >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}\t{{.Image}}' 2>/dev/null | grep -i traefik; then
        :
    else
        echo "  (no traefik containers)"
    fi
fi
echo ""

# -------- 6. Port usage and firewall --------
echo "## 6. Port Usage and Firewall"
echo ""
# G10-04A-FIX-01: ss -tlnp prints process names + command-line arguments
# (visible to root only, but may include paths like /opt/str/staging which
# reveal install paths). By default, omit the -p flag so only port + address
# are shown. MASTER can opt in via STR_REVEAL_PROCESS_NAMES=1.
echo "Listening ports (TCP):"
if command -v ss >/dev/null 2>&1; then
    if [ "$REVEAL_PROCESS_NAMES" = "1" ]; then
        echo "  (process names shown via STR_REVEAL_PROCESS_NAMES=1)"
        ss -tlnp 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via ss)"
    else
        # Omit -p flag: only show address:port, not the process binding it.
        ss -tln 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via ss)"
        echo "  (process names redacted — re-run with STR_REVEAL_PROCESS_NAMES=1 to include them)"
    fi
elif command -v netstat >/dev/null 2>&1; then
    if [ "$REVEAL_PROCESS_NAMES" = "1" ]; then
        netstat -tlnp 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via netstat)"
    else
        netstat -tln 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via netstat)"
        echo "  (process names redacted — re-run with STR_REVEAL_PROCESS_NAMES=1 to include them)"
    fi
else
    echo "  (no ss or netstat available)"
fi
echo ""
echo "STR-relevant ports status:"
for p in 22 80 81 443 3000 5432 5433 8080 8443; do
    if command -v ss >/dev/null 2>&1; then
        if ss -tln 2>/dev/null | awk '{print $4}' | grep -E ":${p}$" >/dev/null; then
            echo "  port $p: IN USE"
        else
            echo "  port $p: free"
        fi
    fi
done
echo ""
echo "Firewall:"
if command -v ufw >/dev/null 2>&1; then
    echo "  ufw status:"
    ufw status 2>&1 | head -15 | sed 's/^/    /'
elif command -v firewall-cmd >/dev/null 2>&1; then
    echo "  firewalld:"
    firewall-cmd --list-all 2>&1 | head -15 | sed 's/^/    /'
elif command -v iptables >/dev/null 2>&1; then
    echo "  iptables (first 15 rules):"
    iptables -L -n 2>&1 | head -15 | sed 's/^/    /'
else
    echo "  (no firewall tooling detected — possible no-manual-firewall setup)"
fi
echo ""

# -------- 7. Available persistent storage --------
echo "## 7. Available Persistent Storage"
echo ""
echo "Mount points (real filesystems only):"
if command -v findmnt >/dev/null 2>&1; then
    findmnt -t ext4,xfs,btrfs,zfs 2>/dev/null | sed 's/^/  /' || echo "  (could not list via findmnt)"
elif command -v df >/dev/null 2>&1; then
    df -hT 2>/dev/null | grep -vE '^(tmpfs|devtmpfs|overlay)' | sed 's/^/  /'
fi
echo ""
echo "Docker root directory and free space:"
if command -v docker >/dev/null 2>&1; then
    DOCKER_ROOT=$(docker info 2>/dev/null | grep 'Docker Root Dir' | awk '{print $4}')
    echo "  Docker Root Dir: ${DOCKER_ROOT:-unknown}"
    if [ -n "${DOCKER_ROOT:-}" ]; then
        df -h "$DOCKER_ROOT" 2>/dev/null | sed 's/^/  /' || echo "  (could not stat)"
    fi
fi
echo ""

# -------- 8. Existing backup infrastructure --------
echo "## 8. Existing Backup Infrastructure"
echo ""
# G10-04A-FIX-01: do NOT print full cron command lines. They may contain
# sensitive paths (e.g., /home/user/.aws/credentials), rsync targets with
# internal hostnames, or database URLs with passwords. Report only:
#   - Number of non-comment, non-empty entries per cron source
#   - Presence of common backup-related binaries
#   - Whether the system appears to have any backup schedule at all
echo "Cron entries (counts only — full command lines are NOT printed):"
if [ -f /etc/crontab ]; then
    CRON_COUNT=$(grep -v '^#' /etc/crontab 2>/dev/null | grep -cv '^$')
    echo "  /etc/crontab: $CRON_COUNT non-comment entries"
else
    echo "  /etc/crontab: (no /etc/crontab file)"
fi
echo ""
echo "  Per-directory cron source counts:"
for d in /var/spool/cron/crontabs /var/spool/cron /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly; do
    if [ -d "$d" ]; then
        # Count non-empty, non-comment files (avoid printing filenames too —
        # filenames in /var/spool/cron/crontabs reveal usernames).
        # Only report the count of files in the directory.
        FILE_COUNT=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo "    $d: $FILE_COUNT files (contents redacted)"
        else
            echo "    $d: empty"
        fi
    fi
done
echo ""
echo "Backup-related binaries available (presence only — no version probe to avoid args leakage):"
BACKUP_TOOLS_FOUND=0
for cmd in restic borg duplicity rsync pgbackrest pg_dump aws rclone; do
    if command -v $cmd >/dev/null 2>&1; then
        # Only report presence — don't run --version (some tools print args/config paths).
        echo "  AVAILABLE: $cmd (path: $(command -v $cmd))"
        BACKUP_TOOLS_FOUND=$((BACKUP_TOOLS_FOUND + 1))
    fi
done
if [ "$BACKUP_TOOLS_FOUND" -eq 0 ]; then
    echo "  (no common backup binaries found — manual rsync or pg_dump from Docker will be the baseline)"
fi
echo ""

# -------- 9. Existing STR Platform installations --------
echo "## 9. Existing STR Platform Installations"
echo ""
echo "Searching for STR-related directories:"
for d in /opt/str /srv/str /var/lib/str /home/*/str /home/*/str-platform /home/*/SyrianTechRenaissance-Platform; do
    # shellcheck disable=SC2086 # intentional globbing on /home/* patterns
    if ls -d $d 2>/dev/null; then
        echo "  found: $d"
    fi
done
echo ""
echo "Existing STR containers (by name pattern):"
if command -v docker >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null \
        | grep -iE 'str-|staging-str|str_platform'; then
        :
    else
        echo "  (no STR-style containers found — fresh install OK)"
    fi
fi
echo ""

# -------- 10. Public IP and connectivity --------
echo "## 10. Public IP and Network"
echo ""
# G10-04A-FIX-01: do NOT print the full public IP by default. MASTER can
# opt in to the full IP via STR_REVEAL_PUBLIC_IP=1 if needed. The masked
# form (e.g., "203.0.x.x") is enough to identify the network class for
# deployment planning.
PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "")
if [ -z "$PUBLIC_IP" ]; then
    echo "  Public IP: (unavailable — outbound HTTPS to ifconfig.me failed)"
else
    if [ "$REVEAL_PUBLIC_IP" = "1" ]; then
        echo "  Public IP (revealed via STR_REVEAL_PUBLIC_IP=1): $PUBLIC_IP"
    else
        # Mask all but the first two octets (for IPv4) or the first two groups (for IPv6).
        # This identifies the network class without revealing the host.
        if echo "$PUBLIC_IP" | grep -q ':'; then
            # IPv6 — show first two groups only
            MASKED=$(echo "$PUBLIC_IP" | awk -F: '{print $1":"$2":x:x:x:x:x:x"}')
        else
            # IPv4 — show first two octets only
            MASKED=$(echo "$PUBLIC_IP" | awk -F. '{print $1"."$2".x.x"}')
        fi
        echo "  Public IP (masked): $MASKED"
        echo "  (To reveal the full IP, re-run with STR_REVEAL_PUBLIC_IP=1)"
    fi
fi
echo ""
# Connectivity checks — these do NOT reveal IPs, only yes/no reachability.
echo "Outbound HTTPS to github.com (5s timeout):"
if curl -sI --max-time 5 https://github.com >/dev/null 2>&1; then
    echo "  OK"
else
    echo "  FAILED — outbound HTTPS restricted or blocked"
fi
echo ""
echo "Outbound HTTPS to registry-1.docker.io (5s timeout):"
if curl -sI --max-time 5 https://registry-1.docker.io/v2/ >/dev/null 2>&1; then
    echo "  OK"
else
    echo "  FAILED — Docker Hub pulls will be slow or blocked"
fi
echo ""

# -------- 11. Time and timezone --------
echo "## 11. Time and Timezone"
echo ""
echo "  date (UTC): $(date -u 2>/dev/null)"
if command -v timedatectl >/dev/null 2>&1; then
    echo "  timezone:   $(timedatectl 2>/dev/null | grep 'Time zone' | awk -F': ' '{print $2}')"
elif [ -f /etc/timezone ]; then
    echo "  timezone:   $(cat /etc/timezone 2>/dev/null)"
else
    echo "  timezone:   unknown"
fi
echo ""

# -------- 12. Swap and file limits --------
echo "## 12. Swap and Process Limits"
echo ""
echo "Swap:"
if command -v swapon >/dev/null 2>&1; then
    swapon --show 2>/dev/null | sed 's/^/  /' || echo "  (no swap)"
else
    echo "  (swapon not available)"
fi
echo ""
echo "Open file limit (ulimit -n): $(ulimit -n 2>/dev/null)"
echo "Max processes (ulimit -u):   $(ulimit -u 2>/dev/null)"
echo ""

echo "============================================================"
echo "End of discovery report."
echo "Review the REDACTION notes below before sharing with GLM."
echo "============================================================"

} | tee "$OUTPUT_FILE"

echo ""
echo "============================================================"
echo "DISCOVERY COMPLETE"
echo "============================================================"
echo "Report saved to: $OUTPUT_FILE"
echo ""
echo "============================================================"
echo "REDACTION CHECKLIST — REVIEW BEFORE SHARING WITH GLM"
echo "============================================================"
echo ""
echo "WHAT THE SCRIPT HAS ALREADY REDACTED FOR YOU:"
echo "  - /etc/docker/daemon.json: only log-driver, log-opts, storage-driver,"
echo "    dns, bip, live-restore, iptables, userland-proxy, default-runtime."
echo "    All other fields show as '(present, value redacted)'."
echo "  - Cron: only ENTRY COUNTS are reported. Command lines and filenames"
echo "    are NOT printed (filenames in /var/spool/cron reveal usernames)."
echo "  - Public IP: masked to first-two-octets (e.g., 203.0.x.x)."
echo "  - Listening sockets: process names redacted by default."
echo "  - Backup tool versions: not probed (only presence + path)."
echo ""
echo "STILL REVIEW MANUALLY BEFORE SHARING:"
echo "  1. Hostname (line 3 of the report) — may include a private"
echo "     project name. Redact if sensitive."
echo "  2. uname -a output — kernel version is generally safe, but"
echo "     review for any custom kernel build names."
echo "  3. /etc/os-release — generally safe, but review."
echo "  4. Docker container names + image names — these reveal what"
echo "     other apps run on the server. Redact if you prefer not to"
echo "     share this with GLM."
echo "  5. Docker network + volume names — same as above."
echo "  6. ss -tln output (without -p) — addresses may include internal"
echo "     IPs like 10.x.x.x or 192.168.x.x. Redact if you do not want"
echo "     GLM to know your internal subnet."
echo "  7. Firewall rules (ufw status, iptables -L) — may include"
echo "     source IP allowlists (e.g., 'allow from 203.0.113.5')."
echo "     Redact any source IPs you do not want to share."
echo "  8. Caddyfile / nginx sites-enabled paths — generally safe."
echo "  9. systemctl status output (first 5 lines per service) —"
echo "     may include active-since timestamps and load numbers."
echo "     Generally safe but review."
echo ""
echo "OPT-IN FIELDS (off by default):"
echo "  - STR_REVEAL_PUBLIC_IP=1     reveals the full public IP"
echo "  - STR_REVEAL_PROCESS_NAMES=1 reveals process names in ss output"
echo ""
echo "WHAT IS ALWAYS SAFE TO SHARE (no review needed):"
echo "  - OS name + version (NAME=, VERSION_ID=)"
echo "  - Architecture (uname -m, dpkg --print-architecture)"
echo "  - CPU count + model name"
echo "  - RAM size + swap size"
echo "  - Disk size + filesystem type"
echo "  - Docker Engine + Compose versions"
echo "  - Docker daemon log rotation config (log-driver, log-opts)"
echo "  - Port availability (free / in use) for 22/80/81/443/3000/5432/etc"
echo "  - Reverse proxy presence (Caddy / NPM / Nginx / Traefik)"
echo "  - Time + timezone"
echo "  - Ulimits (ulimit -n, ulimit -u)"
echo "  - Outbound HTTPS reachability (yes/no, no IPs)"
echo ""
echo "TO VIEW THE REPORT:"
echo "  cat $OUTPUT_FILE"
echo ""
echo "TO SHARE WITH GLM:"
echo "  Paste the file contents into the chat, OR"
echo "  Attach the file if the chat interface supports it."
echo ""
echo "TO RUN WITH OPT-INS:"
echo "  STR_REVEAL_PUBLIC_IP=1 STR_REVEAL_PROCESS_NAMES=1 bash docs/operations/server-discovery.sh"
