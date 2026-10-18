import { NextRequest } from "next/server";
import { getAgreementReadUrl } from "@/modules/partnerships/service";
import { requireAuth, ok, fail } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const result = await getAgreementReadUrl(id, userId);
    return ok(result);
  } catch (e) {
    return fail(e, "api.partnership.agreement.read_url");
  }
}
