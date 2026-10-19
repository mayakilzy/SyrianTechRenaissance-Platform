import { NextRequest, NextResponse } from "next/server";
import { receiveWebhookEvent } from "@/modules/integrations/service";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getMockAdapter } from "@/modules/integrations/mock-adapter";
import { decryptSecret } from "@/modules/integrations/secret-crypto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params;
    const body = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => { headers[key] = value; });
    const providerEventId = headers["x-str-event-id"] || "";
    const eventType = headers["x-str-event-type"] || "unknown";
    const connectionId = headers["x-str-connection-id"] || undefined;
    const timestamp = headers["x-str-timestamp"] || "";
    const signature = headers["x-str-signature"] || "";

    // FAIL CLOSED: require all mandatory headers
    if (!providerEventId) {
      return NextResponse.json({ ok: false, error: { code: "STR_VALIDATION_ERROR", message: "Missing x-str-event-id header" } }, { status: 400 });
    }
    if (!connectionId) {
      return NextResponse.json({ ok: false, error: { code: "STR_VALIDATION_ERROR", message: "Missing x-str-connection-id header" } }, { status: 400 });
    }
    if (!signature) {
      return NextResponse.json({ ok: false, error: { code: "STR_UNAUTHORIZED", message: "Missing x-str-signature header — unsigned events are rejected" } }, { status: 401 });
    }
    if (!timestamp) {
      return NextResponse.json({ ok: false, error: { code: "STR_VALIDATION_ERROR", message: "Missing x-str-timestamp header" } }, { status: 400 });
    }

    // Verify timestamp freshness (within 5 minutes)
    // G09 fix: use Number() instead of parseInt() — parseInt("123abc") returns
    // 123 (ignoring trailing garbage), but Number("123abc") returns NaN.
    // Security headers should not accept malformed values as valid.
    const eventTime = Number(timestamp);
    if (!Number.isFinite(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
      return NextResponse.json({ ok: false, error: { code: "STR_UNAUTHORIZED", message: "Event timestamp outside allowed window" } }, { status: 401 });
    }

    // Verify the provider exists and is approved
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return NextResponse.json({ ok: false, error: { code: "STR_NOT_FOUND", message: "Provider not found" } }, { status: 404 });
    }

    // Verify the connection exists, belongs to this provider, and is active
    const conn = await db.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!conn) {
      return NextResponse.json({ ok: false, error: { code: "STR_NOT_FOUND", message: "Connection not found" } }, { status: 404 });
    }
    if (conn.providerId !== providerId) {
      return NextResponse.json({ ok: false, error: { code: "STR_FORBIDDEN", message: "Connection does not belong to this provider" } }, { status: 403 });
    }
    if (conn.status !== "active") {
      return NextResponse.json({ ok: false, error: { code: "STR_FORBIDDEN", message: `Connection is ${conn.status} — not authorized` } }, { status: 403 });
    }

    // Decrypt the webhook secret (stored encrypted in DB) for HMAC verification
    if (!conn.webhookSecret) {
      return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "No webhook secret configured for this connection" } }, { status: 500 });
    }
    let actualSecret: string;
    try {
      actualSecret = decryptSecret(conn.webhookSecret); // decrypt AES-256-GCM ciphertext
    } catch {
      return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Failed to decrypt webhook secret" } }, { status: 500 });
    }
    const mockAdapter = getMockAdapter();
    const signatureValid = await mockAdapter.verifyWebhook({
      headers,
      body,
      secret: actualSecret,
      timestamp,
      eventId: providerEventId,
      connectionId,
    });

    // FAIL CLOSED: reject if signature is invalid
    if (!signatureValid) {
      return NextResponse.json({ ok: false, error: { code: "STR_UNAUTHORIZED", message: "Webhook signature verification failed" } }, { status: 401 });
    }

    // Store the event (with dedupe for replay prevention)
    const event = await receiveWebhookEvent({
      providerId,
      connectionId,
      providerEventId,
      type: eventType,
      payload: JSON.parse(body),
      signatureValid: true, // always true here — we rejected invalid signatures above
    });

    return NextResponse.json({ ok: true, data: { eventId: event.id, signatureValid: true } });
  } catch (e) {
    // Handle AppError types properly (ConflictError=409 for duplicates, etc.)
    if (e && typeof e === "object" && "code" in e && "status" in e) {
      const appErr = e as { code: string; status: number; message: string };
      return NextResponse.json(
        { ok: false, error: { code: appErr.code, message: appErr.message } },
        { status: appErr.status },
      );
    }
    logger.error("api.integrations.webhook", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
