import { NextRequest } from "next/server";
import { createThread, listThreads } from "@/modules/communications/threads";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const threads = await listThreads(id, userId);
    return ok({ threads });
  } catch (e) {
    return fail(e, "api.projects.threads.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const thread = await createThread(id, userId, body as Parameters<typeof createThread>[2]);
    return ok({ thread }, 201);
  } catch (e) {
    return fail(e, "api.projects.threads.create");
  }
}
