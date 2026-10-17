import { NextRequest } from "next/server";
import { createMilestone, listMilestones } from "@/modules/projects/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const milestones = await listMilestones(projectId, userId);
    return ok({ milestones });
  } catch (e) {
    return fail(e, "api.projects.milestones.get");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const body = await parseJsonBody(req);
    const milestone = await createMilestone(projectId, userId, body as Parameters<typeof createMilestone>[2]);
    return ok({ milestone }, 201);
  } catch (e) {
    return fail(e, "api.projects.milestones.create");
  }
}
