import { NextRequest } from "next/server";
import { approveProvider } from "@/modules/integrations/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";
import { withRequestContext } from "@/lib/request-context-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRequestContext(req, async () => {
    try {
      const userId = await requireAuth();
      const { id } = await params;
      const result = await approveProvider(id, userId);
      return ok({ provider: result });
    } catch (e) {
      return fail(e, "api.integrations.provider.approve");
    }
  });
}
