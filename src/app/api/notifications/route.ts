import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError } from "@/lib/errors";
import { getNotifications } from "@/modules/notifications/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const notifications = await getNotifications(session.user.id, unreadOnly);
    return apiSuccess({ notifications });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.notifications.get", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
