import { NextRequest } from "next/server";
import { listProjectContributions } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const contributions = await listProjectContributions(projectId, userId);
    return ok({ contributions });
  } catch (e) {
    return fail(e, "api.projects.contributions.list");
  }
}
