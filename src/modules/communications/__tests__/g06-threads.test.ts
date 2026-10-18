/**
 * STR G06-B — Project Threads Unit Tests
 *
 * Tests:
 *   1. Project participant can create + post messages
 *   2. Non-participant cannot access EXISTING thread (isolation)
 *   3. Close action is terminal; no further messages
 *   4. Author can edit message (not implemented yet, but test for closed thread)
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
  createTestUser,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import {
  createThread,
  listThreads,
  getThread,
  postMessage,
  closeThread,
} from "@/modules/communications/threads";
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

async function setupProject() {
  const leadId = await createTestUser(run, "rep");
  const reviewerId = await createTestUser(run, "admin");
  const stewardId = await createTestUser(run, "admin");
  const proposal = await createProposal({
    submitterId: leadId,
    title: `G06-B Thread Test ${run.runId}`,
    charter: {
      problemStatement: "Test problem statement with sufficient length for validation.",
      outcomes: "Test outcomes with sufficient length for validation.",
      scope: "Test scope with sufficient length for validation.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "Test acceptance criteria with sufficient length.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId,
    action: "APPROVE",
    reason: "Approved for G06-B thread tests.",
    stewardId,
  });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  if (!project) throw new Error("Project not created");
  run.projectIds.push(project.id);
  return { projectId: project.id, leadId, stewardId };
}

describe("G06-B — Project threads lifecycle", () => {
  it("project participant can create a thread with initial message", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();
    const thread = await createThread(projectId, leadId, {
      title: "Test Thread",
      topic: "general",
      initialMessage: "This is the first message in the thread for testing purposes.",
    });
    expect(thread.title).toBe("Test Thread");
    expect(thread.topic).toBe("general");
    const fetched = await getThread(thread.id, leadId);
    expect(fetched.messages.length).toBe(1);
    expect(fetched.messages[0].body).toContain("first message");
  });

  it("project participant can post messages", async () => {
    run = startTestRun();
    const { projectId, leadId, stewardId } = await setupProject();
    const thread = await createThread(projectId, leadId, {
      title: "Multi-message thread",
      initialMessage: "Initial message.",
    });
    await postMessage(thread.id, stewardId, { body: "Reply from steward." });
    const fetched = await getThread(thread.id, leadId);
    expect(fetched.messages.length).toBe(2);
  });

  it("closing a thread is terminal — no further messages", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();
    const thread = await createThread(projectId, leadId, {
      title: "Will be closed",
      initialMessage: "This thread will be closed.",
    });
    await closeThread(thread.id, leadId);
    await expect(
      postMessage(thread.id, leadId, { body: "Trying to post after close." }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("G06-B — Cross-project isolation (test EXISTING threads)", () => {
  it("user from project A cannot access EXISTING thread in project B", async () => {
    run = startTestRun();
    const projectA = await setupProject();
    const projectB = await setupProject();
    const thread = await createThread(projectA.projectId, projectA.leadId, {
      title: "Project A thread",
      initialMessage: "This thread belongs to project A.",
    });
    // Lead of project B tries to access project A's thread — NotFound
    await expect(getThread(thread.id, projectB.leadId)).rejects.toThrow(NotFoundError);
    await expect(postMessage(thread.id, projectB.leadId, { body: "Intruder." })).rejects.toThrow(NotFoundError);
    await expect(listThreads(projectA.projectId, projectB.leadId)).rejects.toThrow(NotFoundError);
  });
});
