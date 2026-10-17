import { NextRequest } from "next/server";
import { withdrawTask } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const userId = await requireAuth();
    const { tid } = await params;
    const result = await withdrawTask(tid, userId);
    return ok({ task: result });
  } catch (e) {
    return fail(e, "api.projects.task.withdraw");
  }
}
