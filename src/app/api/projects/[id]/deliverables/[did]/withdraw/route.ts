import { NextRequest } from "next/server";
import { withdrawDeliverable } from "@/modules/projects/deliverables";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; did: string }> }) {
  try {
    const userId = await requireAuth();
    const { did } = await params;
    const result = await withdrawDeliverable(did, userId);
    return ok({ deliverable: result });
  } catch (e) {
    return fail(e, "api.projects.deliverable.withdraw");
  }
}
