import { NextRequest } from "next/server";
import { verifyRepresentative } from "@/modules/organizations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";
import { withRequestContext } from "@/lib/request-context-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; repId: string }> }) {
  return withRequestContext(req, async () => {
    try {
      const userId = await requireAuth();
      const { repId } = await params;
      const result = await verifyRepresentative(repId, userId);
      return ok({ representative: result });
    } catch (e) {
      return fail(e, "api.organization.representative.verify");
    }
  });
}
