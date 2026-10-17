import { NextRequest } from "next/server";
import { submitDeliverableVersion } from "@/modules/projects/deliverables";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; did: string }> }) {
  try {
    const userId = await requireAuth();
    const { did } = await params;
    const body = await parseJsonBody(req);
    const version = await submitDeliverableVersion(did, userId, body as Parameters<typeof submitDeliverableVersion>[2]);
    return ok({ version }, 201);
  } catch (e) {
    return fail(e, "api.projects.deliverable.version.submit");
  }
}
