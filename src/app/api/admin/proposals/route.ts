import { NextRequest } from "next/server";
import { listAllProposals } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || undefined;
    const proposals = await listAllProposals(userId, status ? { status } : undefined);
    return ok({ proposals });
  } catch (e) {
    return fail(e, "api.admin.proposals");
  }
}
