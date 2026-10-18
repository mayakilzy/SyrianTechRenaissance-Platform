import { NextRequest } from "next/server";
import { listRecentAuditEvents } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const events = await listRecentAuditEvents(userId, limit);
    return ok({ events });
  } catch (e) {
    return fail(e, "api.admin.audit");
  }
}
