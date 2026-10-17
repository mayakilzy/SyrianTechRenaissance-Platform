import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { suspendProject } from "@/modules/teams/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    await suspendProject(id, session.user.id, String(body.reason ?? "No reason provided"));
    return apiSuccess({ ok: true });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.projects.suspend", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
