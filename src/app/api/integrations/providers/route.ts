import { NextRequest } from "next/server";
import { listProviders } from "@/modules/integrations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET() {
  try {
    const userId = await requireAuth();
    const providers = await listProviders(userId);
    return ok({ providers });
  } catch (e) {
    return fail(e, "api.integrations.providers.list");
  }
}
