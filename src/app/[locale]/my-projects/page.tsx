import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { MyProjectsShell } from "@/components/shell/my-projects-shell";
import { ProjectsExplorer, type ProjectItem } from "./_components/projects-explorer";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listMyContributions } from "@/modules/projects/service";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";

const PROJECT_STATUS_MAP: Record<string, ProjectItem["status"]> = {
  ACTIVE: "active",
  COMPLETED: "completed",
  SUSPENDED: "hold",
  CANCELLED: "hold",
};

export default async function MyProjectsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale as Locale;
  setRequestLocale(loc);
  const tAuth = await getTranslations({ locale: loc, namespace: "auth" });

  // Auth check — render signin Card (not redirect) per g09 E2E contract
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" dir={loc === "ar" ? "rtl" : "ltr"}>
        <div className="max-w-md w-full rounded-xl border border-border bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold mb-2">{tAuth("dashboardTitle")}</h1>
          <p className="text-sm text-muted-foreground mb-6">{tAuth("dashboardWelcome")}</p>
          <Link
            href={loc === "ar" ? "/auth/signin" : `/${loc}/auth/signin`}
            className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-6 py-3 font-medium hover:bg-primary/90 transition-colors"
          >
            {tAuth("signinButton")}
          </Link>
        </div>
      </div>
    );
  }
  const userId = session.user.id;
  const userDisplayName = session.user.email?.split("@")[0] || (loc === "ar" ? "مستخدم" : "User");

  // ─── Fetch real data ───────────────────────────────────────────────────
  // My projects: projects where user is the lead OR a team member.
  const [contributions, leadAndMemberProjects, draftProposals] = await Promise.all([
    listMyContributions(userId).catch(() => []),
    db.project.findMany({
      where: {
        OR: [
          { leadId: userId },
          { memberships: { some: { userId } } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        createdAt: true,
        leadId: true,
        memberships: {
          select: {
            userId: true,
            user: { select: { id: true, displayName: true } },
          },
        },
        tasks: { select: { id: true, status: true } },
        milestones: {
          select: { id: true, status: true, tasks: { select: { id: true, status: true } } },
        },
      },
    }).catch(() => []),
    db.projectProposal.findMany({
      where: { submitterId: userId, status: "DRAFT" },
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    }).catch(() => []),
  ]);

  // Helper: compute progress from milestone task completion ratio
  const computeProgress = (milestones: { status: string; tasks: { status: string }[] }[]) => {
    if (!milestones.length) return 0;
    const totalTasks = milestones.reduce((sum, m) => sum + m.tasks.length, 0);
    if (totalTasks === 0) {
      // No tasks — use milestone status ratio
      const completed = milestones.filter((m) => m.status === "COMPLETED").length;
      return Math.round((completed / milestones.length) * 100);
    }
    const acceptedTasks = milestones.reduce(
      (sum, m) => sum + m.tasks.filter((t) => t.status === "ACCEPTED").length, 0
    );
    return Math.round((acceptedTasks / totalTasks) * 100);
  };

  // Helper: infer project type from title (production would have a type field)
  const inferType = (title: string): { type: string; image: string } => {
    const lower = title.toLowerCase();
    if (lower.includes("تعليم") || lower.includes("education") || lower.includes("edu")) return { type: "education", image: "/my-projects/education.webp" };
    if (lower.includes("زراع") || lower.includes("agri")) return { type: "agriculture", image: "/my-projects/agriculture.webp" };
    if (lower.includes("حكوم") || lower.includes("gov") || lower.includes("municipal")) return { type: "government", image: "/my-projects/government.webp" };
    if (lower.includes("روبوت") || lower.includes("robot")) return { type: "robotics", image: "/my-projects/robotics.webp" };
    if (lower.includes("معرف") || lower.includes("knowledge") || lower.includes("library")) return { type: "knowledge", image: "/my-projects/knowledge.webp" };
    if (lower.includes("طاقة") || lower.includes("energy")) return { type: "energy", image: "/my-projects/energy.webp" };
    return { type: "education", image: "/my-projects/education.webp" };
  };

  // Build project items
  const projectItems: ProjectItem[] = [];

  for (const p of leadAndMemberProjects) {
    const { type, image } = inferType(p.title);
    const progress = computeProgress(p.milestones);
    // Dedupe team members (a user may appear once per membership)
    const memberMap = new Map<string, { id: string; displayName: string }>();
    for (const m of p.memberships) {
      if (!memberMap.has(m.userId)) {
        memberMap.set(m.userId, { id: m.userId, displayName: m.user.displayName || "M" });
      }
    }
    const teamMembers = Array.from(memberMap.values());
    projectItems.push({
      id: p.id,
      title: p.title,
      description: loc === "ar" ? "مشروع نشط في المنصة" : "Active platform project",
      status: PROJECT_STATUS_MAP[p.status] || "active",
      progress: p.status === "COMPLETED" ? 100 : progress,
      members: teamMembers.length,
      openTasks: p.tasks.filter((t) => t.status !== "ACCEPTED" && t.status !== "REJECTED").length,
      updatedAt: p.updatedAt.toISOString(),
      tags: [type, p.status === "COMPLETED" ? "Completed" : "Active", "Platform"],
      image,
      teamMembers: teamMembers.slice(0, 5).map((m) => ({
        id: m.id,
        initial: (m.displayName || "M").charAt(0),
        displayName: m.displayName || "Member",
      })),
      projectType: type,
    });
  }

  // Draft proposals as draft-status items
  for (const prop of draftProposals) {
    const { type, image } = inferType(prop.title);
    projectItems.push({
      id: prop.id,
      title: prop.title,
      description: loc === "ar" ? "مقترح قيد الإعداد" : "Draft proposal",
      status: "draft",
      progress: 10,
      members: 1,
      openTasks: 0,
      updatedAt: prop.updatedAt.toISOString(),
      tags: [type, "Draft", "Proposal"],
      image,
      teamMembers: [{ id: userId, initial: (userDisplayName.charAt(0) || "✎"), displayName: userDisplayName }],
      projectType: type,
    });
  }

  // Compute stats from real data
  const totalProjects = projectItems.length;
  const activeCount = projectItems.filter((p) => p.status === "active").length;
  const completedCount = projectItems.filter((p) => p.status === "completed").length;
  const holdCount = projectItems.filter((p) => p.status === "hold").length;
  const membersCount = new Set(projectItems.flatMap((p) => p.teamMembers.map((m) => m.id))).size;
  const contributionsCount = contributions.length;

  const stats = {
    total: totalProjects,
    active: activeCount,
    completed: completedCount,
    hold: holdCount,
    members: membersCount,
    contributions: contributionsCount,
  };

  const createHref = loc === "ar" ? "/proposals/new" : `/${loc}/proposals/new`;
  const exploreHref = loc === "ar" ? "/opportunities" : `/${loc}/opportunities`;

  return (
    <MyProjectsShell>
      <ProjectsExplorer
        projects={projectItems}
        stats={stats}
        createHref={createHref}
        exploreHref={exploreHref}
      />
    </MyProjectsShell>
  );
}
