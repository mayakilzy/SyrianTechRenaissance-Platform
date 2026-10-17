import { NextRequest } from "next/server";
import { createDeliverable } from "@/modules/projects/deliverables";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const body = await parseJsonBody(req);
    const { taskId } = body as { taskId: string };
    if (!taskId) {
      const { ValidationError } = await import("@/lib/errors");
      throw new ValidationError("taskId is required");
    }
    const deliverable = await createDeliverable(taskId, userId);
    return ok({ deliverable }, 201);
  } catch (e) {
    return fail(e, "api.projects.deliverables.create");
  }
}
