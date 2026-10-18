import { NextRequest } from "next/server";
import { uploadAgreementReference, getAgreementMetadata } from "@/modules/partnerships/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const agreement = await getAgreementMetadata(id, userId);
    return ok({ agreement });
  } catch (e) {
    return fail(e, "api.partnership.agreement.get");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const agreement = await uploadAgreementReference(id, userId, body as Parameters<typeof uploadAgreementReference>[2]);
    return ok({ agreement }, 201);
  } catch (e) {
    return fail(e, "api.partnership.agreement.upload");
  }
}
