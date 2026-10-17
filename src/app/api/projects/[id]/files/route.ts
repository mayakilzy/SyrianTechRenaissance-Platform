import { NextRequest } from "next/server";
import { registerFile, listProjectFiles } from "@/modules/projects/file-evidence";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const files = await listProjectFiles(projectId, userId);
    return ok({ files });
  } catch (e) {
    return fail(e, "api.projects.files.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const body = await parseJsonBody(req);
    const file = await registerFile(projectId, userId, body as Parameters<typeof registerFile>[2]);
    return ok({ file }, 201);
  } catch (e) {
    return fail(e, "api.projects.files.register");
  }
}
