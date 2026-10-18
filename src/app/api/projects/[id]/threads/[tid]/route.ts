import { NextRequest } from "next/server";
import { getThread } from "@/modules/communications/threads";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const userId = await requireAuth();
    const { tid } = await params;
    const thread = await getThread(tid, userId);
    return ok({ thread });
  } catch (e) {
    return fail(e, "api.projects.thread.get");
  }
}
