import { NextRequest } from "next/server";
import { createTask, listTasks } from "@/modules/projects/service";
import { requireAuth, ok, fail, parseJsonBody } from "@/modules/projects/api-helpers";

type TaskStatusFilter =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "CHANGES_REQUESTED"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN";

const ALLOWED_STATUSES: TaskStatusFilter[] = [
  "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED",
  "ACCEPTED", "REJECTED", "WITHDRAWN",
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const url = new URL(req.url);
    const filter: { assigneeId?: string; status?: TaskStatusFilter; milestoneId?: string } = {};
    const assigneeId = url.searchParams.get("assigneeId");
    const statusParam = url.searchParams.get("status");
    const milestoneId = url.searchParams.get("milestoneId");
    if (assigneeId) filter.assigneeId = assigneeId;
    if (statusParam && ALLOWED_STATUSES.includes(statusParam as TaskStatusFilter)) {
      filter.status = statusParam as TaskStatusFilter;
    }
    if (milestoneId) filter.milestoneId = milestoneId;
    const tasks = await listTasks(projectId, userId, filter);
    return ok({ tasks });
  } catch (e) {
    return fail(e, "api.projects.tasks.list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth();
    const { id: projectId } = await params;
    const body = await parseJsonBody(req);
    const task = await createTask(projectId, userId, body as Parameters<typeof createTask>[2]);
    return ok({ task }, 201);
  } catch (e) {
    return fail(e, "api.projects.tasks.create");
  }
}
