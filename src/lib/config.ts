/**
 * STR Platform — Typed & Validated Configuration
 * ----------------------------------------------
 * Single source of truth for all runtime configuration.
 * Every env var is validated by Zod at boot; the app NEVER reads process.env
 * directly outside this module. Fail-fast on misconfiguration.
 *
 * See ADR-01 (stack) and the STR Engineering Playbook §"typed config/env validation".
 */

import { z } from "zod/v4";

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]);
const logFormat = z.enum(["json", "pretty"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("Syrian Tech Renaissance — STR Platform"),
  APP_VERSION: z.string().default("1.0.0"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // PostgreSQL — ADR-01. Required. No silent SQLite fallback in production.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (PostgreSQL connection string)")
    .refine(
      (v) => v.startsWith("postgresql://") || v.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string (ADR-01)",
    ),
  DATABASE_SHADOW_URL: z.string().optional(),

  // Auth — scaffolded in G01, activated in G02.
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_TRUST_HOST: z
    .union([z.string(), z.boolean()])
    .transform((v) => v === true || v === "true")
    .default(true),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Integration Core — types only in G01; values consumed by G07 dispatcher.
  INTEGRATIONS_OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  INTEGRATIONS_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  INTEGRATIONS_WEBHOOK_SECRET: z.string().optional(),

  // Security
  REQUEST_ID_HEADER: z.string().default("x-request-id"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Logging
  LOG_LEVEL: logLevel.default("info"),
  LOG_FORMAT: logFormat.default("json"),

  // Object storage — scaffolded (ADR-02); not connected in G01.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_USE_PATH_STYLE: z
    .union([z.string(), z.boolean()])
    .transform((v) => v === true || v === "true")
    .default(true),

  // i18n
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(["ar", "en"]).default("ar"),
  NEXT_PUBLIC_LOCALES: z
    .string()
    .default("ar,en")
    .transform((v) => v.split(",").map((s) => s.trim())),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/**
 * Parse and validate environment variables.
 * Throws on invalid config — the app should not boot with a broken environment.
 */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    const msg =
      `[STR] Environment configuration is invalid.\n` +
      `The application cannot start safely until these are corrected:\n${issues}\n` +
      `See .env.example for the expected shape.`;
     
    console.error(msg);
    throw new Error("STR_ENV_INVALID");
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Convenience accessor; lazily loads on first use. */
export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return (loadEnv() as Record<string, unknown>)[prop];
  },
});

/** True when running in a local dev / sandbox environment. */
export const isDev = process.env.NODE_ENV !== "production";

/** True when running automated tests. */
export const isTest = process.env.NODE_ENV === "test";
