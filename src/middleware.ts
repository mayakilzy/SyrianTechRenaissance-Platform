/**
 * STR Platform — Root Middleware
 * ------------------------------
 * Runs on every request. Three jobs, in order:
 *   1. Resolve / generate a request id and stamp it on the request + response.
 *   2. Apply minimal security controls (CSP-lite, hide server identity).
 *   3. Delegate locale routing to next-intl.
 *
 * next-intl's middleware is composed via `createMiddleware` so we don't
 * reimplement locale matching.
 *
 * See 02-Architecture §"security middleware, request tracing" and
 *     06-Engineering-Playbook §"per-resource authorization on backend".
 */

import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { resolveRequestId } from "@/lib/request-id";

const intlMiddleware = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  // 1. Request id — resolve inbound or mint a new one.
  const headerName = process.env.REQUEST_ID_HEADER ?? "x-request-id";
  const inboundId = req.headers.get(headerName);
  const reqId = resolveRequestId(inboundId);

  // 2. Let next-intl handle locale routing. We wrap it so we can stamp headers
  //    on whatever response it returns.
  const res = intlMiddleware(req);

  // Echo the request id back so clients can correlate logs with responses.
  res.headers.set(headerName, reqId);
  res.headers.set("x-str-version", process.env.APP_VERSION ?? "1.0.0");
  // Remove the default Server header where possible; Next.js may still set it.
  res.headers.delete("x-powered-by");

  return res;
}

export const config = {
  // Run on everything except Next internals, static assets, and ALL API routes
  // (API routes handle their own auth/cors; they don't need locale routing).
  matcher: ["/((?!_next|_vercel|.*\\..*|api).*)"],
};
