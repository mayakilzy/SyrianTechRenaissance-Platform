/**
 * STR Platform — Prisma Client Singleton
 * --------------------------------------
 * One client per process; reused across hot-reloads in dev. Query/error logs
 * go to Prisma's stdout emitter; the structured logger handles app-level logs.
 *
 * The client is only instantiated on demand (lazy) so the sandbox preview —
 * which has no live PostgreSQL — can boot the home page without a connection.
 * Routes that actually need the DB will fail loudly if it's unreachable.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __strPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  return new PrismaClient({
    // stdout emission keeps Prisma logs visible in dev without fighting
    // TypeScript's event-listener inference. App-level structured logging
    // is handled by src/lib/logger.ts.
    log: [
      { level: "error", emit: "stdout" },
      { level: "warn", emit: "stdout" },
    ],
  });
}

function getClient(): PrismaClient {
  if (globalForPrisma.__strPrisma) return globalForPrisma.__strPrisma;
  const client = createClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__strPrisma = client;
  }
  return client;
}

/**
 * Lazy accessor. Importing this module does NOT connect; only calling `db`
 * does. Routes that need the database call `db` directly; routes that don't
 * (home page, health, i18n samples) never trigger a connection.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_t, prop: string) {
    const client = getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
