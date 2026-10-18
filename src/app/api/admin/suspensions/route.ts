import { NextRequest } from "next/server";
import { listSuspendedProjects } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const projects = await listSuspendedProjects(userId);
    return ok({ projects });
  } catch (e) {
    return fail(e, "api.admin.suspensions");
  }
}
