import { NextRequest } from "next/server";
import { getMilestone, updateMilestone } from "@/modules/projects/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const userId = await requireAuth();
    const { mid } = await params;
    const milestone = await getMilestone(mid, userId);
    return ok({ milestone });
  } catch (e) {
    return fail(e, "api.projects.milestone.get");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const userId = await requireAuth();
    const { mid } = await params;
    const body = await parseJsonBody(req);
    const milestone = await updateMilestone(mid, userId, body as Parameters<typeof updateMilestone>[2]);
    return ok({ milestone });
  } catch (e) {
    return fail(e, "api.projects.milestone.update");
  }
}
