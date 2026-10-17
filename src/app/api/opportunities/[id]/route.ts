import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getOpportunityById } from "@/modules/opportunities/service";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const { id } = await params;
    const opp = await getOpportunityById(id);
    if (!opp) throw new NotFoundError("Opportunity not found");

    // Authorization: creator, reviewers, admins can see any status.
    // Others can only see PUBLISHED.
    const isCreator = opp.createdById === session.user.id;
    const isAdmin = await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "admin", scope: "global", revokedAt: null } });
    const isReviewer = await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "reviewer", scope: "global", revokedAt: null } });

    if (!isCreator && !isAdmin && !isReviewer && opp.status !== "PUBLISHED") {
      throw new NotFoundError("Opportunity not found"); // 404 to avoid leaking existence
    }

    return apiSuccess({ opportunity: opp });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.opportunity.get", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
