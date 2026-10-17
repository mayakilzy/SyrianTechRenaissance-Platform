/**
 * STR G03 — Test Database Isolation Helper
 * Provides TRUE test isolation without global deleteMany({}).
 * Each test creates a unique "test run" with a random ID.
 * Cleanup deletes ONLY that run's data — no global wipes, no catch{}.
 */
import { db } from "@/lib/db";
import { randomBytes } from "node:crypto";

export interface TestRun {
  runId: string;
  userIds: string[];
}

export function startTestRun(): TestRun {
  return { runId: randomBytes(4).toString("hex"), userIds: [] };
}

export function trackUser(run: TestRun, userId: string): void {
  run.userIds.push(userId);
}

export async function cleanupTestRun(run: TestRun): Promise<void> {
  if (run.userIds.length === 0) return;
  const proposals = await db.projectProposal.findMany({
    where: { submitterId: { in: run.userIds } },
    select: { id: true },
  });
  const proposalIds = proposals.map((p) => p.id);
  const projects = await db.project.findMany({
    where: { proposalId: { in: proposalIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);
  const teams = await db.team.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);

  if (teamIds.length > 0) {
    await db.teamInvitation.deleteMany({ where: { teamId: { in: teamIds } } });
    await db.teamMembership.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  if (projectIds.length > 0) {
    await db.resourceGrant.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.stewardAssignment.deleteMany({ where: { projectId: { in: projectIds } } });
  }
  await db.team.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.reviewDecision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.project.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.charterRevision.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.projectProposal.deleteMany({ where: { id: { in: proposalIds } } });
  await db.roleGrant.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.emailVerification.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.passwordReset.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.teamMembership.deleteMany({ where: { userId: { in: run.userIds } } });
  await db.teamInvitation.deleteMany({
    where: { OR: [{ inviteeId: { in: run.userIds } }, { inviterId: { in: run.userIds } }] },
  });
  await db.stewardAssignment.deleteMany({ where: { stewardId: { in: run.userIds } } });
  await db.user.deleteMany({ where: { id: { in: run.userIds } } });
}

export async function createTestUser(
  run: TestRun,
  role: "member" | "reviewer" | "steward" | "admin" = "member",
  displayName?: string,
): Promise<string> {
  const roles = ["member"];
  if (role === "reviewer") roles.push("reviewer");
  if (role === "steward") roles.push("steward");
  if (role === "admin") {
    roles.push("admin");
    roles.push("reviewer");
    roles.push("steward");
  }
  const user = await db.user.create({
    data: {
      email: `g03run-${run.runId}-${role}-${randomBytes(2).toString("hex")}@str-test.local`,
      displayName: displayName ?? `Test ${role}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: roles.map((r) => ({ role: r, scope: "global" })) },
    },
  });
  trackUser(run, user.id);
  return user.id;
}
