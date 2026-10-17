/**
 * STR Platform — Request ID (Edge-safe)
 * -------------------------------------
 * This module is safe to import from Edge Middleware. It uses the Web Crypto
 * API (globalThis.crypto) which is available in both Edge and Node runtimes.
 *
 * The AsyncLocalStorage-based request context lives in request-context.ts and
 * is Node-only (used by API routes and server components, NOT middleware).
 */

/**
 * Generate a new request id. Uses the inbound header value when provided and
 * well-formed; otherwise mints a new one via Web Crypto.
 */
export function resolveRequestId(headerValue?: string | null): string {
  if (headerValue && /^[A-Za-z0-9_-]{8,128}$/.test(headerValue)) {
    return headerValue;
  }
  // globalThis.crypto is available in Edge and Node 19+ runtimes.
  return `req_${globalThis.crypto.randomUUID()}`;
}
