import { NextRequest } from "next/server";
import { verifyOrganization } from "@/modules/organizations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";
import { withRequestContext } from "@/lib/request-context-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRequestContext(req, async () => {
    try {
      const userId = await requireAuth();
      const { id } = await params;
      const result = await verifyOrganization(id, userId);
      return ok({ organization: result });
    } catch (e) {
      return fail(e, "api.organization.verify");
    }
  });
}
