import { NextRequest } from "next/server";
import { registerOrganization, listOrganizations } from "@/modules/organizations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const filter: { status?: string } = {};
    const status = url.searchParams.get("status");
    if (status) filter.status = status;
    const orgs = await listOrganizations(userId, filter);
    return ok({ organizations: orgs });
  } catch (e) {
    return fail(e, "api.organizations.list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const body = await parseJsonBody(req);
    const org = await registerOrganization(userId, body as Parameters<typeof registerOrganization>[1]);
    return ok({ organization: org }, 201);
  } catch (e) {
    return fail(e, "api.organizations.register");
  }
}
