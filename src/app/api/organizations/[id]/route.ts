import { NextRequest } from "next/server";
import { getOrganization } from "@/modules/organizations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const org = await getOrganization(id, userId);
    return ok({ organization: org });
  } catch (e) {
    return fail(e, "api.organization.get");
  }
}
