import { NextRequest } from "next/server";
import { listAllTeams } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const teams = await listAllTeams(userId);
    return ok({ teams });
  } catch (e) {
    return fail(e, "api.admin.teams");
  }
}
