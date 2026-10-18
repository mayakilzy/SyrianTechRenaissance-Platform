import { NextRequest } from "next/server";
import { revokeRepresentative } from "@/modules/organizations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; repId: string }> }) {
  try {
    const userId = await requireAuth();
    const { repId } = await params;
    const body = await parseJsonBody(req);
    const reason = (body as { reason?: string }).reason || "";
    const result = await revokeRepresentative(repId, userId, reason);
    return ok({ representative: result });
  } catch (e) {
    return fail(e, "api.organization.representative.revoke");
  }
}
