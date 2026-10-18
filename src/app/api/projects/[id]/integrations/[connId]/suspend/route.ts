import { NextRequest } from "next/server";
import { suspendConnection } from "@/modules/integrations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; connId: string }> }) {
  try {
    const userId = await requireAuth();
    const { connId } = await params;
    const body = await parseJsonBody(req);
    const reason = (body as { reason?: string }).reason || "";
    const result = await suspendConnection(connId, userId, reason);
    return ok({ connection: result });
  } catch (e) {
    return fail(e, "api.integrations.connection.suspend");
  }
}
