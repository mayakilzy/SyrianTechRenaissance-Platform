import { NextRequest } from "next/server";
import { submitJob, getJob } from "@/modules/integrations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; connId: string }> }) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId");
    if (jobId) {
      const job = await getJob(jobId, userId);
      return ok({ job });
    }
    return ok({ jobs: [] });
  } catch (e) {
    return fail(e, "api.integrations.jobs.get");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; connId: string }> }) {
  try {
    const userId = await requireAuth();
    const { connId } = await params;
    const body = await parseJsonBody(req);
    const input = { ...(body as Record<string, unknown>), connectionId: connId } as Parameters<typeof submitJob>[1];
    const job = await submitJob(userId, input);
    return ok({ job }, 201);
  } catch (e) {
    return fail(e, "api.integrations.jobs.submit");
  }
}
