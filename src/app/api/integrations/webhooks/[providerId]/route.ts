import { NextRequest, NextResponse } from "next/server";
import { receiveWebhookEvent } from "@/modules/integrations/service";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getMockAdapter } from "@/modules/integrations/mock-adapter";

export async function POST(req: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params;
    const body = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => { headers[key] = value; });
    const providerEventId = headers["x-str-event-id"] || "";
    const eventType = headers["x-str-event-type"] || "unknown";
    const connectionId = headers["x-str-connection-id"] || undefined;

    if (!providerEventId) {
      return NextResponse.json({ ok: false, error: { code: "STR_VALIDATION_ERROR", message: "Missing x-str-event-id header" } }, { status: 400 });
    }

    // Verify the provider exists
    const provider = await db.integrationProvider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return NextResponse.json({ ok: false, error: { code: "STR_NOT_FOUND", message: "Provider not found" } }, { status: 404 });
    }

    // Verify the webhook signature
    let signatureValid = false;
    if (connectionId) {
      const conn = await db.integrationConnection.findUnique({ where: { id: connectionId } });
      if (conn && conn.webhookSecretHash) {
        // For the mock adapter, we use the stored hash as the "secret" (simplified for G07)
        // In production, the actual secret would be retrieved from a key manager
        const mockAdapter = getMockAdapter();
        signatureValid = await mockAdapter.verifyWebhook({
          headers,
          body,
          secret: conn.webhookSecretHash, // simplified: in production, this would be the actual secret
        });
      }
    }

    // Store the event (with dedupe for replay prevention)
    const event = await receiveWebhookEvent({
      providerId,
      connectionId,
      providerEventId,
      type: eventType,
      payload: JSON.parse(body),
      signatureValid,
    });

    return NextResponse.json({ ok: true, data: { eventId: event.id, signatureValid } });
  } catch (e) {
    // Use the shared fail() helper which handles AppError types properly
    // (returns the correct HTTP status for ConflictError=409, NotFoundError=404, etc.)
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
