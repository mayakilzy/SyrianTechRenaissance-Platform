import { NextRequest } from "next/server";
import { recordImpact, listImpactRecords } from "@/modules/impact/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const records = await listImpactRecords(id, userId);
    return ok({ impactRecords: records });
  } catch (e) {
    return fail(e, "api.projects.impact.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const record = await recordImpact(id, userId, body as Parameters<typeof recordImpact>[2]);
    return ok({ impactRecord: record }, 201);
  } catch (e) {
    return fail(e, "api.projects.impact.record");
  }
}
