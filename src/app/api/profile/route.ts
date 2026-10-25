import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError } from "@/lib/errors";
import { updateOwnProfile, getOwnProfile } from "@/modules/profiles/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const profile = await getOwnProfile(session.user.id);
    return apiSuccess({ profile });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.profile.get", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const body = await req.json().catch(() => null);
    if (!body) throw new (await import("@/lib/errors")).ValidationError("Invalid JSON body");
    await updateOwnProfile(session.user.id, body);
    const profile = await getOwnProfile(session.user.id);
    return apiSuccess({ profile });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message, ...(e as any).meta ? { meta: (e as any).meta } : {} } }, { status: e.status });
    logger.error("api.profile.update", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
