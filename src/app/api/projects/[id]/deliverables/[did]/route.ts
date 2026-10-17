import { NextRequest } from "next/server";
import { getDeliverable } from "@/modules/projects/deliverables";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; did: string }> }) {
  try {
    const userId = await requireAuth();
    const { did } = await params;
    const deliverable = await getDeliverable(did, userId);
    return ok({ deliverable });
  } catch (e) {
    return fail(e, "api.projects.deliverable.get");
  }
}
