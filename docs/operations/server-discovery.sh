#!/usr/bin/env bash
# ============================================================
# STR Platform — Server Discovery Script (G10-04A Track A)
# ------------------------------------------------------------
# READ-ONLY diagnostic script. MASTER executes this on the
# staging server; GLM analyses the output.
#
# THIS SCRIPT DOES NOT:
#   - Install anything
#   - Remove anything
#   - Modify any file outside /tmp
#   - Start or stop any service
#   - Change firewall rules
#   - Change DNS
#   - Change container state
#
# Output: structured report saved to /tmp/str-g10-04a-discovery-<ts>.txt
# Print the file contents and share with GLM.
# ============================================================

set -uo pipefail  # NO -e: we want to continue even if a probe fails

OUTPUT_FILE="/tmp/str-g10-04a-discovery-$(date -u +%Y%m%dT%H%M%SZ).txt"

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
    echo "  Daemon config (/etc/docker/daemon.json):"
    if [ -f /etc/docker/daemon.json ]; then
        cat /etc/docker/daemon.json | sed 's/^/    /'
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
echo "Listening ports (TCP):"
if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via ss)"
elif command -v netstat >/dev/null 2>&1; then
    netstat -tlnp 2>/dev/null | head -30 | sed 's/^/  /' || echo "  (could not list via netstat)"
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
echo "System cron (root):"
if [ -f /etc/crontab ]; then
    grep -v '^#' /etc/crontab 2>/dev/null | grep -v '^$' | sed 's/^/  /' || echo "  (empty)"
else
    echo "  (no /etc/crontab)"
fi
echo ""
echo "Cron directories:"
for d in /var/spool/cron/crontabs /var/spool/cron /etc/cron.d /etc/cron.daily /etc/cron.hourly; do
    if [ -d "$d" ]; then
        echo "  $d:"
        ls -la "$d" 2>/dev/null | sed 's/^/    /'
    fi
done
echo ""
echo "Backup-related binaries available:"
for cmd in restic borg duplicity rsync pgbackrest pg_dump aws rclone; do
    if command -v $cmd >/dev/null 2>&1; then
        echo "  AVAILABLE: $cmd ($($cmd --version 2>&1 | head -1))"
    fi
done
echo ""

# -------- 9. Existing STR Platform installations --------
echo "## 9. Existing STR Platform Installations"
echo ""
echo "Searching for STR-related directories:"
for d in /opt/str /srv/str /var/lib/str /home/*/str /home/*/str-platform /home/*/SyrianTechRenaissance-Platform; do
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
echo "Public IP (via ifconfig.me, 5s timeout):"
PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "(unavailable)")
echo "  $PUBLIC_IP"
echo ""
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
echo "REDACTION CHECKLIST before sharing with GLM:"
echo "  - The report does NOT include passwords, tokens, or private keys."
echo "  - Review for any private IPs, hostnames, or emails you do not want to share."
echo "  - Cron jobs may include command lines — review for sensitive paths or args."
echo "  - Safe to share: OS, architecture, CPU/RAM/disk, Docker version,"
echo "    port usage, firewall status, proxy inventory."
echo ""
echo "To view the report:"
echo "  cat $OUTPUT_FILE"
echo ""
echo "To share with GLM:"
echo "  Paste the file contents into the chat, OR"
echo "  Attach the file if the chat interface supports it."
