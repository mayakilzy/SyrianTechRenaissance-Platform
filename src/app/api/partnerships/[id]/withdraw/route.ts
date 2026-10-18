import { NextRequest } from "next/server";
import { withdrawPartnershipRequest } from "@/modules/partnerships/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const result = await withdrawPartnershipRequest(id, userId);
    return ok({ partnership: result });
  } catch (e) {
    return fail(e, "api.partnership.withdraw");
  }
}
