import { NextRequest } from "next/server";
import { postMessage } from "@/modules/communications/threads";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const userId = await requireAuth();
    const { tid } = await params;
    const body = await parseJsonBody(req);
    const message = await postMessage(tid, userId, body as Parameters<typeof postMessage>[2]);
    return ok({ message }, 201);
  } catch (e) {
    return fail(e, "api.projects.thread.message");
  }
}
