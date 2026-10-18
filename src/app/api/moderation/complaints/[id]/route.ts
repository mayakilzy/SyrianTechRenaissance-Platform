import { NextRequest } from "next/server";
import { getComplaint } from "@/modules/moderation/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const complaint = await getComplaint(id, userId);
    return ok({ complaint });
  } catch (e) {
    return fail(e, "api.moderation.complaint.get");
  }
}
