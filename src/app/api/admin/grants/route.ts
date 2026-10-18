import { NextRequest } from "next/server";
import { listAllGrants } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const grants = await listAllGrants(userId);
    return ok({ grants });
  } catch (e) {
    return fail(e, "api.admin.grants");
  }
}
