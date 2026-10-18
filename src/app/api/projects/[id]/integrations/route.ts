import { NextRequest } from "next/server";
import { createConnection, listConnections } from "@/modules/integrations/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const connections = await listConnections(id, userId);
    return ok({ connections });
  } catch (e) {
    return fail(e, "api.integrations.connections.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id } = await params;
    const body = await parseJsonBody(req);
    const input = { ...(body as Record<string, unknown>), projectId: id } as Parameters<typeof createConnection>[1];
    const result = await createConnection(userId, input);
    return ok(result, 201);
  } catch (e) {
    return fail(e, "api.integrations.connections.create");
  }
}
