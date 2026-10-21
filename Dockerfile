# ============================================================
# STR Platform — Dockerfile (multi-stage)
# dev target:  full source + bun dev server (hot reload)
# prod target: standalone Next.js output (ADR-02 — app + worker same image)
# ============================================================

# ---- Base ----
FROM oven/bun:1.3 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Dev (used by docker compose) ----
FROM base AS dev
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev"]

# ---- Build (production) ----
FROM base AS build
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx prisma generate
# Provide minimal env for Next.js build (config.ts validates at import time).
# DATABASE_URL is required by Zod schema; provide a dummy for build only.
# The real DATABASE_URL is injected at runtime via docker-compose env_file.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV AUTH_SECRET="build-placeholder-secret-at-least-16-chars"
RUN bun run build

# ---- Production runtime ----
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# G10-01 FINAL HARDENING: copy the full .next/server directory.
# The standalone output includes server.js but references files in
# .next/server/ (e.g., preview-props.json, chunks). Without these,
# the server crashes with ENOENT on startup.
COPY --from=build /app/.next/server ./.next/server
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# G10-01: Worker source + dependencies.
# The worker is NOT part of the Next.js standalone build — it's a separate
# process that imports from src/modules/ and src/lib/ directly.
# Bun runs TypeScript natively and resolves path aliases via tsconfig.json.
# The web app runs `node server.js` (standalone); the worker runs
# `bun run src/worker/index.ts`. Same image, different CMD.
#
# G10-01 RUNTIME ROOT-CAUSE FIX: copy bun.lock to prod stage so
# 'bun install --production --frozen-lockfile' uses the EXACT same
# dependency versions as the build stage. Without this, bun resolves
# ^16.1.1 to the latest 16.x (e.g., 16.4.2) which has standalone
# runtime bugs not present in 16.1.3 (the locked version).
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
RUN bun install --production --frozen-lockfile

EXPOSE 3000
# Default: web app. Override CMD in docker-compose for the worker:
#   command: bun run src/worker/index.ts
CMD ["node", "server.js"]
