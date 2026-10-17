import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError } from "@/lib/errors";
import { searchTalent, searchSchema } from "@/modules/talent/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const url = new URL(req.url);
    const params = searchSchema.parse({
      query: url.searchParams.get("query") || undefined,
      skill: url.searchParams.get("skill") || undefined,
      availability: url.searchParams.get("availability") || undefined,
      page: url.searchParams.get("page") || "1",
      pageSize: url.searchParams.get("pageSize") || "20",
    });
    const result = await searchTalent(params);
    return apiSuccess(result);
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.talent.search", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
