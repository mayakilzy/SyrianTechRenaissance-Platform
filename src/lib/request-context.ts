/**
 * STR Platform — Request Context (correlation id propagation, Node-only)
 * ---------------------------------------------------------------------
 * Provides per-request storage for the correlation id and any other request
 * scoped values, so deeply-nested domain code can read them without passing a
 * context object through every call. Uses AsyncLocalStorage so the context is
 * isolated per concurrent request.
 *
 * IMPORTANT: This module uses node:async_hooks and is NOT Edge-compatible.
 * Edge Middleware should import from "@/lib/request-id" instead.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "@/lib/config";

export interface RequestContext {
  reqId: string;
  startedAt: number;
  actorId?: string;
  locale?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run a callback within a request context. */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** Read the current request context, if any. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Read the current request id, if any. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.reqId;
}

/** Name of the header used to propagate request ids. */
export const REQUEST_ID_HEADER = env.REQUEST_ID_HEADER;
