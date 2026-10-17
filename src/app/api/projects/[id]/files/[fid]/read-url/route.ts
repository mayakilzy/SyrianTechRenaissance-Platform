import { NextRequest } from "next/server";
import { getFileReadUrl, getFileMetadata } from "@/modules/projects/file-evidence";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fid: string }> }) {
  try {
    const userId = await requireAuth();
    const { fid, id: projectId } = await params;
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "metadata") {
      const file = await getFileMetadata(fid, userId);
      return ok({ file });
    }
    const result = await getFileReadUrl(fid, userId);
    return ok(result);
  } catch (e) {
    return fail(e, "api.projects.files.read_url");
  }
}
