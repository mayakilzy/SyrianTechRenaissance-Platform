import { NextRequest } from "next/server";
import { getAdminDashboardStats } from "@/modules/admin/dashboard";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const stats = await getAdminDashboardStats(userId);
    return ok({ stats });
  } catch (e) {
    return fail(e, "api.admin.dashboard");
  }
}
