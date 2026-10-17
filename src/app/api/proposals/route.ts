import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ValidationError, ForbiddenError } from "@/lib/errors";
import { createProposal, getProposalsForUser } from "@/modules/proposals/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const proposals = await getProposalsForUser(session.user.id);
    return apiSuccess({ proposals });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.proposals.get", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const body = await req.json().catch(() => null);
    if (!body) throw new ValidationError("Invalid JSON body");
    const proposal = await createProposal({
      submitterId: session.user.id,
      title: String(body.title ?? ""),
      charter: body.charter,
    });
    return apiSuccess({ proposal }, 201);
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.proposals.create", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
