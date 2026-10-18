import { NextRequest } from "next/server";
import { cancelJob } from "@/modules/integrations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; connId: string; jobId: string }> }) {
  try {
    const userId = await requireAuth();
    const { jobId } = await params;
    const body = await parseJsonBody(req);
    const reason = (body as { reason?: string }).reason || "";
    const result = await cancelJob(jobId, userId, reason);
    return ok({ job: result });
  } catch (e) {
    return fail(e, "api.integrations.job.cancel");
  }
}
