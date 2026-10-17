/**
 * STR Platform — Structured Logger
 * --------------------------------
 * Emits one JSON object per line (production) or pretty-printed (dev).
 * Every log line carries the request correlation id when available so a full
 * request can be reconstructed from logs. Never logs secrets — caller is
 * responsible for redacting payload fields before passing them in.
 *
 * See ADR-02 and Engineering Playbook §"structured JSON logs, request correlation IDs".
 */

import { env, isDev } from "@/lib/config";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  reqId?: string;
  [k: string]: unknown;
}

const SEVERITY: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

function shouldEmit(level: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[env.LOG_LEVEL];
}

function write(level: LogLevel, msg: string, ctx: LogContext = {}): void {
  if (!shouldEmit(level)) return;

  const reqId = typeof ctx.reqId === "string" ? ctx.reqId : undefined;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(reqId ? { reqId } : {}),
    ...ctx,
  };

  const line =
    env.LOG_FORMAT === "pretty" || isDev
      ? JSON.stringify(entry, null, 0) // single-line even in dev for grep-ability
      : JSON.stringify(entry);

   
  if (level === "fatal" || level === "error") console.error(line);
   
  else if (level === "warn") console.warn(line);
   
  else console.log(line);
}

/**
 * Logger with optional bound context (e.g. reqId). Use `logger.child(ctx)` to
 * derive a contextual logger inside a request handler.
 */
export const logger = {
  fatal: (msg: string, ctx?: LogContext) => write("fatal", msg, ctx),
  error: (msg: string, ctx?: LogContext) => write("error", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => write("warn", msg, ctx),
  info: (msg: string, ctx?: LogContext) => write("info", msg, ctx),
  debug: (msg: string, ctx?: LogContext) => write("debug", msg, ctx),
  trace: (msg: string, ctx?: LogContext) => write("trace", msg, ctx),
  child(ctx: LogContext) {
    return {
      fatal: (m: string, c?: LogContext) => write("fatal", m, { ...ctx, ...c }),
      error: (m: string, c?: LogContext) => write("error", m, { ...ctx, ...c }),
      warn: (m: string, c?: LogContext) => write("warn", m, { ...ctx, ...c }),
      info: (m: string, c?: LogContext) => write("info", m, { ...ctx, ...c }),
      debug: (m: string, c?: LogContext) => write("debug", m, { ...ctx, ...c }),
      trace: (m: string, c?: LogContext) => write("trace", m, { ...ctx, ...c }),
    };
  },
};
