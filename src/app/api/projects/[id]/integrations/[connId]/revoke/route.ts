import { NextRequest } from "next/server";
import { revokeConnection } from "@/modules/integrations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";
import { withRequestContext } from "@/lib/request-context-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; connId: string }> }) {
  return withRequestContext(req, async () => {
    try {
      const userId = await requireAuth();
      const { connId } = await params;
      const body = await parseJsonBody(req);
      const reason = (body as { reason?: string }).reason || "";
      const result = await revokeConnection(connId, userId, reason);
      return ok({ connection: result });
    } catch (e) {
      return fail(e, "api.integrations.connection.revoke");
    }
  });
}
