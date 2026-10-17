import { NextRequest } from "next/server";
import { startMilestone } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  try {
    const userId = await requireAuth();
    const { mid } = await params;
    const result = await startMilestone(mid, userId);
    return ok({ milestone: result });
  } catch (e) {
    return fail(e, "api.projects.milestone.start");
  }
}
