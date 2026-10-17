#!/usr/bin/env bash
# STR Platform — dev server wrapper
# Overrides the sandbox's system DATABASE_URL (which is SQLite) with the
# PostgreSQL URL required by ADR-01. The real PostgreSQL runs via docker compose
# or CI; the sandbox home page doesn't need a live connection (ADR-05).

set -euo pipefail

export DATABASE_URL="postgresql://str:str_password@localhost:5432/str_platform?schema=public"
export DATABASE_SHADOW_URL="postgresql://str:str_password@localhost:5432/str_platform_shadow?schema=public"
export NODE_ENV="${NODE_ENV:-development}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export LOG_FORMAT="${LOG_FORMAT:-pretty}"
export APP_VERSION="${APP_VERSION:-1.0.0-g01}"

cd /home/z/my-project
exec bun run dev
