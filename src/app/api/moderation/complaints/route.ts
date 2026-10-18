import { NextRequest } from "next/server";
import { fileComplaint, listComplaints } from "@/modules/moderation/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const filter: { status?: string; projectId?: string; targetUserId?: string } = {};
    const status = url.searchParams.get("status");
    const pid = url.searchParams.get("projectId");
    const tuid = url.searchParams.get("targetUserId");
    if (status) filter.status = status;
    if (pid) filter.projectId = pid;
    if (tuid) filter.targetUserId = tuid;
    const complaints = await listComplaints(userId, filter);
    return ok({ complaints });
  } catch (e) {
    return fail(e, "api.moderation.complaints.list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const body = await parseJsonBody(req);
    const complaint = await fileComplaint(userId, body as Parameters<typeof fileComplaint>[1]);
    return ok({ complaint }, 201);
  } catch (e) {
    return fail(e, "api.moderation.complaints.file");
  }
}
