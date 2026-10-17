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
RUN bun run build

# ---- Production runtime ----
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
# The same image runs either the web app or the worker, selected by the
# STR_WORKER env var. See ADR-02.
CMD ["node", "server.js"]
