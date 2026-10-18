import { NextRequest } from "next/server";
import { closeThread } from "@/modules/communications/threads";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const userId = await requireAuth();
    const { tid } = await params;
    const result = await closeThread(tid, userId);
    return ok({ thread: result });
  } catch (e) {
    return fail(e, "api.projects.thread.close");
  }
}
