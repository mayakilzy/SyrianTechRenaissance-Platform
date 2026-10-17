import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError } from "@/lib/errors";
import { createOpportunity, getPublishedOpportunities, getMyOpportunities } from "@/modules/opportunities/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const url = new URL(req.url);
    const mine = url.searchParams.get("mine") === "true";
    if (mine) {
      const result = await getMyOpportunities(session.user.id);
      return apiSuccess({ opportunities: result });
    }
    const page = parseInt(url.searchParams.get("page") || "1");
    const result = await getPublishedOpportunities(page);
    return apiSuccess(result);
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.opportunities.get", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const body = await req.json().catch(() => null);
    if (!body) throw new (await import("@/lib/errors")).ValidationError("Invalid JSON body");
    const opp = await createOpportunity(session.user.id, body);
    return apiSuccess({ opportunity: opp }, 201);
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.opportunities.create", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
