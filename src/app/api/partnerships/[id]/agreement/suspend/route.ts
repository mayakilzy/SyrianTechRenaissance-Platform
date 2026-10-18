import { NextRequest } from "next/server";
import { suspendAgreementReliance } from "@/modules/partnerships/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const reason = (body as { reason?: string }).reason || "";
    const result = await suspendAgreementReliance(id, userId, reason);
    return ok({ partnership: result });
  } catch (e) {
    return fail(e, "api.partnership.agreement.suspend");
  }
}
