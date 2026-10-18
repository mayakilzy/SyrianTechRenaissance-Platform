import { NextRequest } from "next/server";
import { submitPartnershipRequest, listPartnershipRequests } from "@/modules/partnerships/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const filter: { status?: string; organizationId?: string; projectId?: string } = {};
    const status = url.searchParams.get("status");
    const orgId = url.searchParams.get("organizationId");
    const projId = url.searchParams.get("projectId");
    if (status) filter.status = status;
    if (orgId) filter.organizationId = orgId;
    if (projId) filter.projectId = projId;
    const reqs = await listPartnershipRequests(userId, filter);
    return ok({ partnerships: reqs });
  } catch (e) {
    return fail(e, "api.partnerships.list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const body = await parseJsonBody(req);
    const result = await submitPartnershipRequest(userId, body as Parameters<typeof submitPartnershipRequest>[1]);
    return ok({ partnership: result }, 201);
  } catch (e) {
    return fail(e, "api.partnerships.submit");
  }
}
