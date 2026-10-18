import { NextRequest } from "next/server";
import { submitRightsDeclaration, getRightsDeclaration } from "@/modules/partnerships/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const declaration = await getRightsDeclaration(id, userId);
    return ok({ declaration });
  } catch (e) {
    return fail(e, "api.contribution.rights.get");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const declaration = await submitRightsDeclaration(id, userId, body as Parameters<typeof submitRightsDeclaration>[2]);
    return ok({ declaration }, 201);
  } catch (e) {
    return fail(e, "api.contribution.rights.submit");
  }
}
