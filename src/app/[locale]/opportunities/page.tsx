import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { OpportunitiesShell } from "@/components/shell/opportunities-shell";
import { OpportunitiesExplorer, type OpportunityItem } from "./_components/opportunities-explorer";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getPublishedOpportunities } from "@/modules/opportunities/service";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";

// Map OpportunityType enum to the approved design's type categories
const TYPE_MAP: Record<string, string> = {
  PROJECT: "collaborative",
  TASK: "freelance",
  MENTORSHIP: "volunteer",
  INTERNSHIP: "fulltime",
  CONSULTING: "freelance",
  OTHER: "fulltime",
};

// Infer field from title/description
const inferField = (title: string, desc: string): string => {
  const text = (title + " " + desc).toLowerCase();
  if (text.includes("ذكاء") || text.includes("ai") || text.includes("artificial")) return "ai";
  if (text.includes("ويب") || text.includes("web") || text.includes("react") || text.includes("next")) return "web";
  if (text.includes("زراع") || text.includes("agri")) return "agri";
  if (text.includes("تعليم") || text.includes("education") || text.includes("teach")) return "education";
  return "other";
};

const inferExperience = (requirements: string | null): string => {
  if (!requirements) return "all";
  const text = requirements.toLowerCase();
  if (text.includes("senior") || text.includes("خبير") || text.includes("expert")) return "senior";
  if (text.includes("entry") || text.includes("مبتدئ") || text.includes("junior")) return "entry";
  if (text.includes("mid") || text.includes("متوسط") || text.includes("intermediate")) return "mid";
  return "all";
};

const inferImage = (type: string): string => {
  if (type === "freelance") return "/opportunities/freelance.webp";
  if (type === "volunteer") return "/opportunities/trainer.webp";
  if (type === "collaborative") return "/opportunities/agriculture.webp";
  return "/opportunities/ai.webp";
};

const inferTags = (title: string, desc: string, requirements: string | null): string[] => {
  const text = title + " " + desc + " " + (requirements || "");
  const tags: string[] = [];
  const keywords: [string, string][] = [
    ["react", "React"], ["next", "Next.js"], ["python", "Python"], ["ai", "AI"],
    ["type", "TypeScript"], ["iot", "IoT"], ["data", "Data"], ["education", "Education"],
    ["ai", "Artificial Intelligence"], ["web", "Web"], ["agri", "Agriculture"],
  ];
  for (const [kw, label] of keywords) {
    if (text.toLowerCase().includes(kw) && tags.length < 4) tags.push(label);
  }
  return tags.length > 0 ? tags : ["Platform", "Engineering", "Syria"];
};

export default async function OpportunitiesPage({
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

  // ─── Fetch real data ───────────────────────────────────────────────────
  const publishedResult = await getPublishedOpportunities(1, 50).catch(() => ({
    results: [],
    total: 0,
    page: 1,
    pageSize: 50,
  }));

  // Build opportunity items from real published data
  const opportunityItems: OpportunityItem[] = publishedResult.results.map((opp) => {
    const type = TYPE_MAP[opp.type] || "fulltime";
    const field = inferField(String(opp.title || ""), String(opp.description || ""));
    const experience = inferExperience(opp.requirements);
    const daysAgo = opp.publishedAt
      ? Math.floor((Date.now() - new Date(opp.publishedAt).getTime()) / 86400000)
      : 0;
    const tags = inferTags(String(opp.title || ""), String(opp.description || ""), opp.requirements);
    return {
      id: opp.id,
      title: opp.title,
      orgName: opp.createdBy?.displayName || (loc === "ar" ? "مؤسسة" : "Organization"),
      location: opp.location || (opp.isRemote ? (loc === "ar" ? "عن بعد" : "Remote") : (loc === "ar" ? "غير محدد" : "Unspecified")),
      type,
      field,
      experience,
      daysAgo,
      applicants: 0, // No public applicant count API — honest 0
      tags,
      image: inferImage(type),
      isRemote: opp.isRemote,
    };
  });

  // Compute stats from real data
  const totalOpportunities = publishedResult.total;
  const organizationsSet = new Set(publishedResult.results.map((o) => o.createdById));
  const engineersNeeded = totalOpportunities; // Approximation: each opportunity needs ~1 engineer
  const internationalCount = publishedResult.results.filter((o) => o.location && !o.location.toLowerCase().includes("syria") && !o.location.toLowerCase().includes("سوريا")).length;
  const freelanceCount = opportunityItems.filter((o) => o.type === "freelance").length;
  const volunteerCount = opportunityItems.filter((o) => o.type === "volunteer").length;

  const stats = {
    total: totalOpportunities,
    organizations: organizationsSet.size,
    engineersNeeded,
    international: internationalCount,
    freelance: freelanceCount,
    volunteer: volunteerCount,
  };

  const postHref = loc === "ar" ? "/opportunities/new" : `/${loc}/opportunities/new`;

  return (
    <OpportunitiesShell>
      <OpportunitiesExplorer
        opportunities={opportunityItems}
        stats={stats}
        postHref={postHref}
      />
    </OpportunitiesShell>
  );
}
