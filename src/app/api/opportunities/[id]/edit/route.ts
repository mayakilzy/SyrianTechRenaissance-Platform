import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { apiSuccess } from "@/lib/api-response";
import { isAppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { z } from "zod/v4";

const editSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  description: z.string().min(20).max(10000).optional(),
  requirements: z.string().max(5000).optional(),
  location: z.string().max(200).optional(),
  compensationType: z.string().max(50).optional(),
  compensationNote: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(getAuthOptions());
    if (!session?.user?.id) throw new ForbiddenError("Authentication required");
    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body) throw new ValidationError("Invalid JSON body");

    const valid = editSchema.safeParse(body);
    if (!valid.success) throw new ValidationError("Invalid opportunity data");

    const opp = await db.opportunity.findUnique({ where: { id } });
    if (!opp) throw new (await import("@/lib/errors")).NotFoundError("Opportunity not found");
    if (opp.createdById !== session.user.id) throw new ForbiddenError("Only the creator can edit");
    if (opp.status !== "DRAFT" && opp.status !== "NEEDS_REVISION") {
      throw new (await import("@/lib/errors")).ConflictError("Can only edit DRAFT or NEEDS_REVISION opportunities");
    }

    await db.opportunity.update({
      where: { id },
      data: valid.data,
    });

    return apiSuccess({ ok: true });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.status });
    logger.error("api.opportunities.edit", { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false, error: { code: "STR_INTERNAL_ERROR", message: "Internal error" } }, { status: 500 });
  }
}
