import { NextRequest } from "next/server";
import { stewardApproveCompletion } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const result = await stewardApproveCompletion(projectId, userId);
    return ok({ project: result });
  } catch (e) {
    return fail(e, "api.projects.complete.steward");
  }
}
