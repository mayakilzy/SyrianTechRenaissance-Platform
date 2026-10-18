import { NextRequest } from "next/server";
import { addRepresentative, listRepresentatives } from "@/modules/organizations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const reps = await listRepresentatives(id, userId);
    return ok({ representatives: reps });
  } catch (e) {
    return fail(e, "api.organization.representatives.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const rep = await addRepresentative(id, userId, body as Parameters<typeof addRepresentative>[2]);
    return ok({ representative: rep }, 201);
  } catch (e) {
    return fail(e, "api.organization.representatives.add");
  }
}
