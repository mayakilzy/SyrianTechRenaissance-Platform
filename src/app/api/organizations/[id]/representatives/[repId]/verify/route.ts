import { NextRequest } from "next/server";
import { verifyRepresentative } from "@/modules/organizations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; repId: string }> }) {
  try {
    const userId = await requireAuth();
    const { repId } = await params;
    const result = await verifyRepresentative(repId, userId);
    return ok({ representative: result });
  } catch (e) {
    return fail(e, "api.organization.representative.verify");
  }
}
