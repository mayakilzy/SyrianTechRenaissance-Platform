#!/usr/bin/env bash
# Capture G01 acceptance screenshots (Arabic RTL + English LTR).
# Starts the dev server, waits for readiness, takes both screenshots, shuts down.

set -uo pipefail

cd /home/z/my-project

# Kill any stale dev server.
pkill -f "next dev" 2>/dev/null
pkill -f "dev-str" 2>/dev/null
sleep 2

# Start dev server with STR env override.
export DATABASE_URL="postgresql://str:str_password@localhost:5432/str_platform?schema=public"
export DATABASE_SHADOW_URL="postgresql://str:str_password@localhost:5432/str_platform_shadow?schema=public"
export NODE_ENV=development
export LOG_LEVEL=info
export LOG_FORMAT=pretty
export APP_VERSION=1.0.0-g01

rm -rf .next
nohup bun run dev > .zscripts/dev.log 2>&1 &
DEV_PID=$!
echo "Dev server PID: $DEV_PID"

# Wait for readiness (max 30s).
READY=0
for i in $(seq 1 30); do
  if curl -sS -o /dev/null http://localhost:3000/ 2>/dev/null; then
    READY=1
    echo "Dev server ready after ${i}s"
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "FAIL: dev server did not become ready"
  kill $DEV_PID 2>/dev/null
  exit 1
fi

# Give Turbopack a moment to finish initial compile.
sleep 3

mkdir -p tests/e2e/screenshots

# Take Arabic RTL screenshot.
agent-browser close 2>/dev/null || true
agent-browser set viewport 1440 900 2>&1 | tail -1
echo "=== Arabic RTL ==="
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser eval "JSON.stringify({lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, h1: document.querySelector('h1')?.textContent?.trim()})" 2>&1 | tail -1
agent-browser screenshot --full tests/e2e/screenshots/home-ar-rtl.png 2>&1 | tail -1

# Take English LTR screenshot.
echo "=== English LTR ==="
agent-browser open http://localhost:3000/en 2>&1 | tail -1
agent-browser wait --load networkidle 2>&1 | tail -1
agent-browser eval "JSON.stringify({lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title, h1: document.querySelector('h1')?.textContent?.trim()})" 2>&1 | tail -1
agent-browser screenshot --full tests/e2e/screenshots/home-en-ltr.png 2>&1 | tail -1

# Take health endpoint screenshot (JSON in browser).
echo "=== Health ==="
agent-browser open http://localhost:3000/api/v1/health 2>&1 | tail -1
agent-browser wait 1000 2>&1 | tail -1
agent-browser screenshot tests/e2e/screenshots/health-endpoint.png 2>&1 | tail -1

agent-browser close 2>/dev/null || true

echo "=== Files ==="
ls -la tests/e2e/screenshots/

# Keep dev server running for further interaction.
echo "Dev server still running on PID $DEV_PID"
echo "To stop: kill $DEV_PID"
