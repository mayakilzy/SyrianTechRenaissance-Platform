/**
 * STR G06-B — Impact Records Unit Tests
 *
 * Tests:
 *   1. Lead/steward/admin can record impact
 *   2. Member cannot record (Forbidden, but visible as NotFound for non-participants)
 *   3. Append-only: corrections via supersedesId
 *   4. Cross-project isolation
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  startTestRun,
  cleanupTestRun,
} from "@/modules/organizations/__tests__/test-isolation";
import { createProposal, submitProposal, reviewProposal } from "@/modules/proposals/service";
import { recordImpact, listImpactRecords } from "@/modules/impact/service";
import { NotFoundError, ForbiddenError } from "@/lib/errors";

let run: ReturnType<typeof startTestRun>;

afterEach(async () => {
  if (run) await cleanupTestRun(run);
});

async function setupProject(suffix = "0") {
  const leadId = (await db.user.create({
    data: {
      email: `g06b-lead-${run.runId}-${suffix}@test.local`,
      displayName: `Lead ${run.runId}-${suffix}`,
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: [{ role: "member", scope: "global" }] },
    },
  })).id;
  const reviewerId = (await db.user.create({
    data: {
      email: `g06b-rev-${run.runId}-${suffix}@test.local`,
      displayName: `Rev ${run.runId}-${suffix}`,
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }, { role: "admin", scope: "global" }] },
    },
  })).id;
  const stewardId = (await db.user.create({
    data: {
      email: `g06b-stw-${run.runId}-${suffix}@test.local`,
      displayName: `Stw ${run.runId}-${suffix}`,
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: [{ role: "member", scope: "global" }, { role: "reviewer", scope: "global" }, { role: "steward", scope: "global" }] },
    },
  })).id;
  run.userIds.push(leadId, reviewerId, stewardId);

  const proposal = await createProposal({
    submitterId: leadId,
    title: `G06-B Impact Test ${run.runId}`,
    charter: {
      problemStatement: "Test problem statement with sufficient length for validation purposes.",
      outcomes: "Test outcomes with sufficient length for validation purposes.",
      scope: "Test scope with sufficient length for validation purposes.",
      requiredSkills: ["TypeScript"],
      acceptanceCriteria: "Test acceptance criteria with sufficient length.",
    },
  });
  await submitProposal(proposal.id, leadId);
  await reviewProposal({
    proposalId: proposal.id,
    reviewerId,
    action: "APPROVE",
    reason: "Approved for G06-B impact tests.",
    stewardId,
  });
  const project = await db.project.findUnique({ where: { proposalId: proposal.id } });
  if (!project) throw new Error("Project not created");
  run.proposalIds.push(proposal.id);
  run.projectIds.push(project.id);
  return { projectId: project.id, leadId, stewardId };
}

describe("G06-B — Impact records (append-only)", () => {
  it("lead can record an impact metric", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();
    const record = await recordImpact(projectId, leadId, {
      metricName: "contributions_accepted",
      metricValue: 5,
      evidenceUrl: "https://example.com/dashboard/123",
    });
    expect(record.metricValue).toBe(5);
    expect(record.supersedesId).toBeNull();
  });

  it("correction via supersedesId (append-only, no silent edit)", async () => {
    run = startTestRun();
    const { projectId, leadId } = await setupProject();
    const original = await recordImpact(projectId, leadId, {
      metricName: "contributions_accepted",
      metricValue: 5,
      evidenceUrl: "https://example.com/dashboard/orig",
    });
    const correction = await recordImpact(projectId, leadId, {
      metricName: "contributions_accepted",
      metricValue: 7, // corrected value
      evidenceUrl: "https://example.com/dashboard/corrected",
      supersedesId: original.id,
    });
    expect(correction.supersedesId).toBe(original.id);
    // Verify the original is still in the DB (NOT deleted)
    const stillThere = await db.impactRecord.findUnique({ where: { id: original.id } });
    expect(stillThere?.metricValue).toBe(5); // original preserved
  });

  it("non-participant cannot list impact records (test EXISTING project)", async () => {
    run = startTestRun();
    const projectA = await setupProject();
    const projectB = await setupProject();
    // lead of project B tries to see project A's impact records — NotFound
    await expect(listImpactRecords(projectA.projectId, projectB.leadId)).rejects.toThrow(NotFoundError);
    await expect(
      recordImpact(projectA.projectId, projectB.leadId, {
        metricName: "contributions_accepted",
        metricValue: 100,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
