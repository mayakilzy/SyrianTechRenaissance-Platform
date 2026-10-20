import { NextRequest } from "next/server";
import { suspendOrganization } from "@/modules/organizations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";
import { withRequestContext } from "@/lib/request-context-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRequestContext(req, async () => {
    try {
      const userId = await requireAuth();
      const { id } = await params;
      const body = await parseJsonBody(req);
      const reason = (body as { reason?: string }).reason || "";
      const result = await suspendOrganization(id, userId, reason);
      return ok({ organization: result });
    } catch (e) {
      return fail(e, "api.organization.suspend");
    }
  });
}
