import { NextRequest } from "next/server";
import { reviewDeliverable } from "@/modules/projects/deliverables";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; did: string }> }) {
  try {
    const userId = await requireAuth();
    const { did } = await params;
    const body = await parseJsonBody(req);
    const result = await reviewDeliverable(did, userId, body as Parameters<typeof reviewDeliverable>[2]);
    return ok({ review: result });
  } catch (e) {
    return fail(e, "api.projects.deliverable.review");
  }
}
