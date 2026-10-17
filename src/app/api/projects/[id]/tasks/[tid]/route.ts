import { NextRequest } from "next/server";
import { getTask } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const userId = await requireAuth();
    const { tid } = await params;
    const task = await getTask(tid, userId);
    return ok({ task });
  } catch (e) {
    return fail(e, "api.projects.task.get");
  }
}
