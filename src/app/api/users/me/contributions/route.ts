import { NextRequest } from "next/server";
import { listMyContributions } from "@/modules/projects/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireAuth();
    const contributions = await listMyContributions(userId);
    return ok({ contributions });
  } catch (e) {
    return fail(e, "api.users.me.contributions");
  }
}
