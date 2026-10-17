# G03 — Project Proposals and Team Governance — Evidence Report

**Mission ID:** G03
**Status:** ✅ DONE — STR-GOV-TEAM-01 enforced in DB + service layer
**Branch:** `feat/g03-proposals-teams`
**Latest Commit:** `7ba5437`
**Latest CI:** PASS (both jobs, all steps green)
**Repository:** `mayakilzy/SyrianTechRenaissance-Platform`

---

## A. What Was Built

### Proposals module (`src/modules/proposals/`)
- **ProjectProposal** with lifecycle: DRAFT → SUBMITTED → NEEDS_REVISION → APPROVED | REJECTED | WITHDRAWN
- **CharterRevision** (immutable after submission, versioned v1/v2/v3...)
- **ReviewDecision** with conflict-of-interest guard
- Charter editor with all 10 G03 sections: problem, outcomes, scope, exclusions, beneficiaries, architecture, skills, resources, risks, rights, acceptance criteria
- **Atomic `approveProposal()`** — the ONLY code path that creates a Team

### Teams module (`src/modules/teams/`)
- **NO `createTeam` function** — structural guarantee; teams created ONLY by proposal approval
- `inviteMember` (lead/steward only), `acceptInvitation`, `declineInvitation`
- `leaveTeam` (lead blocked without transfer)
- `suspendProject` (steward only) — revokes all resource grants
- `reactivateProject`

### Governance (`src/modules/governance/authorize-project.ts`)
- Project-scoped roles: `project_lead`, `steward`, `team_member`
- `authorizeProject(actor, action, projectId)` — fail-closed
- `guardProject()` convenience wrapper

### Prisma schema (G03 migration, 269 lines)
9 new models + 5 enums:
- ProjectProposal, CharterRevision, ReviewDecision
- Project (unique on proposalId — one project per approved proposal)
- Team (unique on projectId — one team per project)
- TeamMembership, TeamInvitation, StewardAssignment, ResourceGrant

### API routes (10 routes)
- `POST/GET /api/proposals` — create + list
- `POST /api/proposals/[id]/{submit,review,revise,withdraw}`
- `POST /api/projects/[id]/{suspend,reactivate}`
- `POST /api/teams/[id]/invite`
- `POST /api/teams/invitations/[id]/{accept,decline}`

### UI pages (i18n RTL/LTR)
- `/proposals` — list (my proposals + review queue)
- `/proposals/new` — charter editor (all 10 sections)
- `/proposals/[id]` — detail + review actions (approve/reject/revise with steward assignment)
- `/projects/[id]` — team detail (lead, steward, members)

---

## B. STR-GOV-TEAM-01 Enforcement

**The policy: no operational team without an approved project charter, named team lead, and institutional steward.**

Enforced at THREE layers:

1. **Database**: `Project.proposalId` is `@unique` (one project per proposal). `Team.projectId` is `@unique` (one team per project). `StewardAssignment.projectId` is `@unique` (one steward per project). `Project.stewardId` is non-null (required).

2. **Service layer**: The `approveProposal()` transaction creates Project + Team + StewardAssignment + TeamMembership(LEAD) atomically. If any step fails, the entire transaction rolls back. The `@unique` constraint on `Project.proposalId` makes it idempotent — a duplicate approval attempt throws P2002, which is caught and returns the existing project.

3. **API layer**: There is NO `/api/teams` POST route. The only way to create a team is through `/api/proposals/[id]/review` with `action: "APPROVE"`. A structural unit test confirms `createTeam` is not exported from the teams module.

---

## C. Conflict-of-Interest Guards

- **Self-review blocked**: `reviewProposal()` throws `ForbiddenError` if `reviewerId === proposal.submitterId`
- **Steward=submitter blocked**: approval throws `ForbiddenError` if `stewardId === proposal.submitterId`
- **Tested**: 2 unit tests verify both guards

---

## D. Test Results (CI-verified)

### Unit tests: 74 passed (62 G01/G02 + 12 G03)
G03 tests cover:
1. ✅ Proposal lifecycle (create, submit, permissions)
2. ✅ Conflict-of-interest (self-review blocked, steward=submitter blocked)
3. ✅ Atomic team creation (Project+Team+Steward+Lead in one transaction)
4. ✅ Idempotency (double-approval → no duplicate team)
5. ✅ No-steward block (approval without steward fails)
6. ✅ Team invitations (invite, accept, permissions)
7. ✅ Project suspension (steward only, revokes grants)
8. ✅ Structural: no `createTeam` exported

### E2E tests: 12 passed (4 auth-flow + 4 security + 4 RTL/LTR from G01/G02)

---

## E. Honest Classification

| Component | Status |
|---|---|
| Proposal lifecycle + charter editor | ✅ implemented + tested |
| Atomic team creation (STR-GOV-TEAM-01) | ✅ implemented + tested |
| Conflict-of-interest guards | ✅ implemented + tested |
| Team invitations + membership | ✅ implemented + tested |
| Project suspension + resource revocation | ✅ implemented + tested |
| Project-scoped authorization | ✅ implemented + tested |
| UI pages (RTL/LTR) | ✅ implemented |
| G03 E2E browser test | ⏳ not written (unit tests cover the critical invariants; E2E can be added in a follow-up) |

---

## F. Git Protocol Compliance

Per the G02 merge authorization lesson:
- ✅ G03 branch (`feat/g03-proposals-teams`) created from `main` (`96310e6`)
- ✅ All commits on the G03 branch
- ✅ `main` untouched (still at `96310e6`)
- ✅ No force push on any branch
- ⚠️ Minor incident: the initial G03 commit (`bdfaff3`) was accidentally made on `main` locally due to branch-switching in sandboxed shell sessions. Fixed by pointing `feat/g03-proposals-teams` to `bdfaff3` and resetting local `main` back to `96310e6`. Remote `main` was never touched. No force push was needed — the fix was a clean `git branch -f` + `git push` (fast-forward).

---

**Reported by:** GLM (Lead Development AI)
**G03 status:** ✅ Ready for review
