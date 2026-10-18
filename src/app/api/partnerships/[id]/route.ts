import { NextRequest } from "next/server";
import { getPartnershipRequest } from "@/modules/partnerships/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const req = await getPartnershipRequest(id, userId);
    return ok({ partnership: req });
  } catch (e) {
    return fail(e, "api.partnership.get");
  }
}
