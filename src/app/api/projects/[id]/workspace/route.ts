import { NextRequest } from "next/server";
import { getProjectWorkspace } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const workspace = await getProjectWorkspace(projectId, userId);
    return ok(workspace);
  } catch (e) {
    return fail(e, "api.projects.workspace.get");
  }
}
