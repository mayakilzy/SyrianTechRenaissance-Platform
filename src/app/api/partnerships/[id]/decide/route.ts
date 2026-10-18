import { NextRequest } from "next/server";
import { decidePartnershipRequest } from "@/modules/partnerships/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const result = await decidePartnershipRequest(id, userId, body as Parameters<typeof decidePartnershipRequest>[2]);
    return ok({ decision: result });
  } catch (e) {
    return fail(e, "api.partnership.decide");
  }
}
