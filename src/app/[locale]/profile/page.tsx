import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ProfileShell } from "@/components/shell/profile-shell";
import { ProfileContent } from "./_components/profile-content";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOwnProfile, calculateCompleteness } from "@/modules/profiles/service";
import { listMyContributions } from "@/modules/projects/service";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";

export default async function ProfilePage({
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
          <Link href={loc === "ar" ? "/auth/signin" : `/${loc}/auth/signin`} className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-6 py-3 font-medium hover:bg-primary/90 transition-colors">
            {tAuth("signinButton")}
          </Link>
        </div>
      </div>
    );
  }
  const userId = session.user.id;

  // ─── Fetch real profile data ───────────────────────────────────────────
  let profile: Awaited<ReturnType<typeof getOwnProfile>> | null = null;
  let contributions: Awaited<ReturnType<typeof listMyContributions>> = [];
  let profileError = false;

  try {
    profile = await getOwnProfile(userId);
  } catch {
    // Profile not found — the user may not have created one yet
    profileError = true;
  }

  try {
    contributions = await listMyContributions(userId);
  } catch {
    // Contributions unavailable — show 0
  }

  // Fetch user's projects (as lead or team member)
  const myProjects = await db.project.findMany({
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
    },
    take: 3,
    orderBy: { updatedAt: "desc" },
  }).catch(() => []);

  // Compute real stats
  const completedProjects = myProjects.filter((p) => p.status === "COMPLETED").length;
  const totalProjects = myProjects.length;
  const skillsCount = profile?.skills?.length || 0;
  const contributionsCount = contributions.length;

  // Calculate profile completeness from real fields
  const completeness = profile
    ? calculateCompleteness({
        displayName: profile.displayName,
        headline: profile.headline || undefined,
        bio: profile.bio || undefined,
        avatarUrl: profile.avatarUrl || undefined,
        contactEmail: profile.contactEmail || undefined,
        location: profile.location || undefined,
        websiteUrl: profile.websiteUrl || undefined,
      })
    : 0;

  // Map skill levels to display percentages (truthful — based on enum, not fabricated)
  const skillLevelMap: Record<string, number> = {
    BEGINNER: 25,
    INTERMEDIATE: 50,
    ADVANCED: 75,
    EXPERT: 100,
  };

  // Map availability enum to display text
  const availabilityMap: Record<string, string> = {
    OPEN: loc === "ar" ? "متاحة للتعاون" : "Open to Collaboration",
    LIMITED: loc === "ar" ? "متاحة بشكل محدود" : "Limited Availability",
    CLOSED: loc === "ar" ? "غير متاحة حالياً" : "Not Available",
  };

  const profileData = profile ? {
    displayName: profile.displayName,
    headline: profile.headline || "",
    bio: profile.bio || "",
    avatarUrl: profile.avatarUrl,
    location: profile.location || "",
    availability: availabilityMap[profile.availability] || "",
    isAvailable: profile.availability === "OPEN" || profile.availability === "LIMITED",
    completeness,
    skills: profile.skills.map((ms) => ({
      name: ms.skill.name,
      level: skillLevelMap[ms.level] || 50,
    })),
    portfolio: profile.portfolio.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || "",
    })),
    visibility: profile.visibility,
  } : null;

  const stats = {
    completedProjects,
    contributions: contributionsCount,
    skills: skillsCount,
    connections: 0, // No connections API — honest 0
    mentorshipHours: 0, // No mentorship API — honest 0
    completedTasks: 0, // No task completion API — honest 0
  };

  const myProjectsData = myProjects.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
  }));

  return (
    <ProfileShell>
      <ProfileContent
        profile={profileData}
        stats={stats}
        myProjects={myProjectsData}
        hasError={profileError}
        locale={loc}
      />
    </ProfileShell>
  );
}
