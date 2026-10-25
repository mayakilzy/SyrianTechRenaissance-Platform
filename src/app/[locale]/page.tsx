import { setRequestLocale, getTranslations } from "next-intl/server";
import { getServerSession } from "next-auth";
import { HomeShell, type HomeShellProps } from "@/components/home/home-shell";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { db } from "@/lib/db";
import { getPublishedOpportunities } from "@/modules/opportunities/service";
import type { Locale } from "@/i18n/config";

/**
 * STR UI-01 — Public Homepage
 *
 * Source-first integration of the approved Page 01 v1.2 reference
 * (SHA-256 58835abdb30ce0c2b33f858faf88c57279092fb1180da69dc7a0e423660b641a)
 * into the existing Next.js application.
 *
 * Server component — fetches real platform data via the service layer + Prisma
 * and passes it to <HomeShell> (client) for rendering. Public page: no auth
 * required; profile widget shows "Guest" with signin link if not authenticated.
 *
 * Real data fetched (truthful, no fabrication):
 *   - engineers: count of users with status=ACTIVE (label kept as "engineers"
 *     per v1.2 visual reference; the platform's primary audience is engineers;
 *     no separate "engineer" role enum exists in the schema — only "member"|"admin"
 *     via RoleGrant. ACTIVE users = real platform members.)
 *   - activeProjects: count of projects with status=ACTIVE
 *   - contributionsThisMonth: count of ContributionReference records with
 *     acceptedAt >= start of current month
 *   - openOpportunities: count of published opportunities (via service)
 *   - upcomingEvents: 0 — NO events API exists (truthful empty state, "—")
 *   - featuredProjects: top 3 ACTIVE projects from DB (real titles)
 *
 * Auth-aware (public page):
 *   - If authenticated: profile widget shows user name + initials
 *   - If not: profile widget shows "Guest" + link to /auth/signin
 *
 * Strict boundaries respected:
 *   - No redesign (v1.2 visual identity preserved via home.css)
 *   - No modification of Pages 02–05 (this file replaces only page.tsx)
 *   - No shadcn template replacing approved source
 *   - No fabricated stats (real DB counts only; "—" for unavailable)
 *   - No schema/auth changes
 *   - No section removal (all v1.2 sections preserved with truthful empty states)
 */

// ─── Helpers ────────────────────────────────────────────────────────────────
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) {
    const first = parts[0] ?? "U";
    return ((first[0] ?? "U") + (first[1] ?? first[0] ?? "U")).toUpperCase();
  }
  const first = parts[0] ?? "U";
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "U") + (last[0] ?? "U")).toUpperCase();
}

// Cycle through the 3 available project images based on index
const PROJECT_IMAGES: HomeShellProps["featuredProjects"][number]["imageKey"][] = [
  "education", "health", "city",
];

// ─── Page ──────────────────────────────────────────────────────────────────
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale as Locale;
  setRequestLocale(loc);
  void getTranslations({ locale: loc, namespace: "home" }); // warm translations

  // ─── Auth-aware profile widget ────────────────────────────────────────────
  // The homepage is PUBLIC — no auth required. But if the user is signed in,
  // we show their name + initials in the profile widget (truthful, no fabrication).
  // If not signed in, the profile widget shows "Guest" + a link to /auth/signin.
  const session = await getServerSession(getAuthOptions()).catch(() => null);
  let profile: HomeShellProps["profile"];
  if (session?.user?.id) {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { displayName: true, email: true },
    }).catch(() => null);
    const fallbackName = loc === "ar" ? "مستخدم" : "User";
    const displayName = user?.displayName || user?.email?.split("@")[0] || fallbackName;
    profile = {
      isAuthenticated: true,
      displayName,
      initials: getInitials(displayName),
      roleLabel: loc === "ar" ? "عضو نشط" : "Active member",
    };
  } else {
    profile = { isAuthenticated: false };
  }

  // ─── Real platform stats (server-side, never fabricated) ──────────────────
  // Each query is wrapped in try/catch to ensure the homepage never crashes if
  // the DB is temporarily unavailable — falls back to 0 (truthful "—").
  //
  // Schema reality (verified during integration):
  //   - User has no `role` field — only RoleGrant relation ("member"|"admin")
  //   - No "engineer" role enum exists. Platform members = users with status=ACTIVE.
  //     v1.2 visual reference labels this stat "مهندس ومهندسة / Engineers" —
  //     we keep that label for visual fidelity and use the truthful count of
  //     active platform members (the platform's primary audience is engineers).
  //   - There is no `Contribution` model — it's `ContributionReference` (created
  //     when a deliverable version is accepted, with `acceptedAt` timestamp).
  //   - `ProjectProposal` has no `tags` field — featured project tags will be
  //     empty (truthful: no tag schema exists yet).
  const [
    activeMembersCount,
    activeProjectsCount,
    contributionsThisMonthCount,
    publishedOpportunitiesResult,
  ] = await Promise.all([
    db.user.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    db.project.count({ where: { status: "ACTIVE" } }).catch(() => 0),
    db.contributionReference.count({
      where: {
        acceptedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }).catch(() => 0),
    getPublishedOpportunities(1, 1).catch(() => ({ results: [], total: 0, page: 1, pageSize: 1 })),
  ]);

  const openOpportunitiesCount = publishedOpportunitiesResult?.total ?? 0;

  // Upcoming events: there is NO events API in the platform (truthful).
  // We display "—" rather than fabricating a count.
  const upcomingEventsCount = 0;

  // ─── Featured projects: top 3 ACTIVE projects (real titles) ──────────────
  // ProjectProposal has no `tags` field in the schema — featured project tags
  // will be empty (truthful: no tag taxonomy exists yet). The JSX gracefully
  // renders no tags when the array is empty.
  const featuredProjectRows = await db.project.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  }).catch(() => []);

  // Build the featured projects array
  const featuredProjects: HomeShellProps["featuredProjects"] = featuredProjectRows.map((p, i) => ({
    id: p.id,
    title: p.title,
    description: loc === "ar"
      ? "مشروع نشط في المنصة — انضم أو تابع التقدم"
      : "Active project on the platform — join or follow progress",
    tags: [], // truthful empty — no tag schema in ProjectProposal
    progress: 0, // No progress API for projects; show 0% honestly
    statusBadge: "open" as const, // Active projects are open for contribution
    imageKey: PROJECT_IMAGES[i % PROJECT_IMAGES.length] ?? "education",
  }));

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <HomeShell
      stats={{
        engineers: activeMembersCount,
        activeProjects: activeProjectsCount,
        contributionsThisMonth: contributionsThisMonthCount,
        openOpportunities: openOpportunitiesCount,
        upcomingEvents: upcomingEventsCount,
      }}
      featuredProjects={featuredProjects}
      profile={profile}
    />
  );
}
