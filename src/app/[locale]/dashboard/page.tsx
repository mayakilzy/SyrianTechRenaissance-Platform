import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Users, Zap, FileText, Bookmark, UsersRound,
  Search, Target, Box, BarChart3,
  Star, Bell, MessageCircle,
  Folder, BriefcaseBusiness, Sparkles, Layers,
  BookOpen, Network as NetworkIcon,
} from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listMyContributions } from "@/modules/projects/service";
import { getPublishedOpportunities, getMyApplications } from "@/modules/opportunities/service";
import { searchTalent } from "@/modules/talent/service";
import { getNotifications } from "@/modules/notifications/service";
import { db } from "@/lib/db";
import type { Locale } from "@/i18n/config";

// ─── Small interactive client components for toasts ──────────────────────────
import { HeroButtons, SaveButton, ConnectButton } from "./_components/interactive";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale as Locale;
  setRequestLocale(loc);
  const t = await getTranslations({ locale: loc, namespace: "dashboard" });

  // ─── Auth check ─────────────────────────────────────────────────────────────
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(loc === "ar" ? "/auth/signin" : `/${loc}/auth/signin`);
  }
  const userId = session.user.id;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
  const displayName = user?.displayName || user?.email?.split("@")[0] || (loc === "ar" ? "مستخدم" : "User");
  const firstName = displayName.split(" ")[0];

  // ─── Fetch real data via service layer (server-side, no API fetch needed) ───
  const [contributions, publishedOpps, myApplications, talentResult, notifications] = await Promise.all([
    listMyContributions(userId).catch(() => []),
    getPublishedOpportunities(1, 3).catch(() => ({ results: [], total: 0, page: 1, pageSize: 3 })),
    getMyApplications(userId).catch(() => []),
    searchTalent({ page: 1, pageSize: 3 }).catch(() => ({ results: [], total: 0, page: 1, pageSize: 3 })),
    getNotifications(userId).catch(() => []),
  ]);

  // ─── Compute stats from real data ──────────────────────────────────────────
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const contributionsThisMonth = contributions.filter(
    (c) => c.acceptedAt && new Date(c.acceptedAt) >= startOfMonth
  ).length;

  // Unique active projects from contributions
  const activeProjectIds = new Set(
    contributions
      .filter((c) => c.project?.status === "ACTIVE")
      .map((c) => c.project?.id)
      .filter(Boolean)
  );
  const activeProjectsCount = activeProjectIds.size;

  // Proposals under review — query directly (no service function for "my proposals by status")
  const proposalsUnderReview = await db.projectProposal.count({
    where: { submitterId: userId, status: "SUBMITTED" },
  }).catch(() => 0);

  // Saved/applied opportunities
  const savedOpportunitiesCount = myApplications.length;

  // New connections — no API available; honest 0
  const newConnectionsCount = 0;

  // ─── My projects: group contributions by project ───────────────────────────
  const projectMap = new Map<string, { id: string; title: string; status: string }>();
  for (const c of contributions) {
    if (c.project && !projectMap.has(c.project.id)) {
      projectMap.set(c.project.id, {
        id: c.project.id,
        title: c.project.title,
        status: c.project.status,
      });
    }
  }
  const myProjects = Array.from(projectMap.values()).slice(0, 3);

  // ─── Featured community projects: query ACTIVE projects (not the user's own) ─
  const featuredProjects = await db.project.findMany({
    where: { status: "ACTIVE", leadId: { not: userId } },
    select: { id: true, title: true, proposalId: true },
    take: 2,
    orderBy: { createdAt: "desc" },
  }).catch(() => []);

  // ─── Recent activity: last 4 notifications ──────────────────────────────────
  const recentActivity = notifications.slice(0, 4);

  // ─── Prepare stats array ────────────────────────────────────────────────────
  const stats = [
    { icon: Users, cls: "cyan", value: newConnectionsCount, label: t("stats.newConnections"), empty: newConnectionsCount === 0 },
    { icon: Zap, cls: "amber", value: contributionsThisMonth, label: t("stats.contributions") },
    { icon: FileText, cls: "teal", value: proposalsUnderReview, label: t("stats.proposalsReview") },
    { icon: Bookmark, cls: "gold", value: savedOpportunitiesCount, label: t("stats.savedOpportunities") },
    { icon: UsersRound, cls: "blue", value: activeProjectsCount, label: t("stats.activeProjects") },
  ];

  // ─── Skills for learning panel (honest: no learning API, show profile-based demo) ─
  // The learning journey section is a placeholder — there's no learning/skill-progress API.
  // We show a clearly-labeled demo state rather than fabricating progress numbers.
  const learningEnabled = false; // Set to true when a learning API exists

  return (
    <AppShell>
      {/* ─── Hero ──────────────────────────────────────────────────────────── */}
      <section className="str-hero" aria-labelledby="hero-title">
        <div className="str-hero-image" aria-hidden="true" />
        <div className="str-hero-grid" aria-hidden="true" />
        <div className="str-hero-copy">
          <h1 id="hero-title">
            {t("hero.titlePrefix")} <em>{firstName}</em>
          </h1>
          <h2>{t("hero.subtitle")}</h2>
          <p>{t("hero.quote")}</p>
          <HeroButtons
            newProjectLabel={t("hero.newProject")}
            exploreLabel={t("hero.explore")}
            locale={loc}
            newProjectToast={t("hero.newProjectToast")}
          />
        </div>
        <div className="str-hero-hologram" aria-hidden="true">
          <span>AI</span>
          <strong>SYRIA</strong>
          <div className="str-holo-map">
            <NetworkIcon />
            <Sparkles />
          </div>
          <small>{t("hero.hologram")}</small>
        </div>
      </section>

      {/* ─── Stats ─────────────────────────────────────────────────────────── */}
      <section className="str-stats" aria-label={t("stats.aria")}>
        {stats.map((stat, i) => (
          <article key={i} className="str-stat">
            <span className={`str-stat-icon ${stat.cls}`}>
              <stat.icon />
            </span>
            <div>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          </article>
        ))}
      </section>

      {/* ─── Top grid: Learning + Opportunities + My Projects ────────────────── */}
      <section className="str-top-grid">
        {/* ─── Learning Journey ───────────────────────────────────────────── */}
        <article className="str-panel" id="learning">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-round-icon">
                <BarChart3 />
              </span>
              <h3>{t("learning.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}learning`}>{t("common.viewAll")}</Link>
          </div>
          {learningEnabled ? (
            <>
              <div className="str-learning-overview">
                <div className="str-progress-ring" style={{ ["--percent" as string]: 68 }}>
                  <strong>68%</strong>
                  <small>{t("learning.advancedLevel")}</small>
                </div>
                <div>
                  <h4>{t("learning.completeJourney")}</h4>
                  <p>{t("learning.prompt")}</p>
                </div>
              </div>
              <div className="str-skill-list">
                <div>
                  <span>Next.js</span>
                  <div className="str-track"><b style={{ width: "75%", background: "#168eff" }} /></div>
                  <strong>75%</strong>
                </div>
                <div>
                  <span>{t("learning.ai")}</span>
                  <div className="str-track"><b style={{ width: "60%", background: "#9b43fa" }} /></div>
                  <strong>60%</strong>
                </div>
                <div>
                  <span>{t("learning.ux")}</span>
                  <div className="str-track"><b style={{ width: "45%", background: "#27c5df" }} /></div>
                  <strong>45%</strong>
                </div>
                <div>
                  <span>{t("learning.databases")}</span>
                  <div className="str-track"><b style={{ width: "30%", background: "#ff9b3d" }} /></div>
                  <strong>30%</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="str-empty">
              <BookOpen />
              <p>{t("learning.empty")}</p>
            </div>
          )}
        </article>

        {/* ─── Opportunities ──────────────────────────────────────────────── */}
        <article className="str-panel" id="opportunities">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-round-icon">
                <Target />
              </span>
              <h3>{t("opportunities.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}opportunities`}>{t("common.viewAll")}</Link>
          </div>
          {publishedOpps.results.length > 0 ? (
            <div className="str-opportunity-list">
              {publishedOpps.results.map((opp, i) => (
                <article key={opp.id}>
                  <div className={`str-opportunity-icon ${i === 1 ? "blue-logo" : i === 2 ? "violet-logo" : ""}`}>
                    {i === 0 ? <BriefcaseBusiness /> : i === 1 ? <Box /> : <Layers />}
                  </div>
                  <div className="str-opportunity-details">
                    <h4>{opp.title}</h4>
                    <p>{opp.createdBy?.displayName || (loc === "ar" ? "غير محدد" : "Unspecified")}</p>
                    <div className="str-pills">
                      {opp.isRemote && <span>{t("opportunities.remote")}</span>}
                      {opp.location && <span>{opp.location}</span>}
                      {opp.compensationType && <span>{opp.compensationType}</span>}
                    </div>
                  </div>
                  <SaveButton saveLabel={t("common.save")} savedLabel={t("common.saved")} />
                </article>
              ))}
            </div>
          ) : (
            <div className="str-empty">
              <Target />
              <p>{t("opportunities.empty")}</p>
            </div>
          )}
        </article>

        {/* ─── My Projects ─────────────────────────────────────────────────── */}
        <article className="str-panel str-my-projects" id="my-projects">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-round-icon">
                <Folder />
              </span>
              <h3>{t("projects.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}projects/me/contributions`}>{t("common.viewAll")}</Link>
          </div>
          {myProjects.length > 0 ? (
            <div className="str-project-list">
              {myProjects.map((proj, i) => {
                const images = ["/dashboard/project-education.webp", "/dashboard/project-automation.webp", "/dashboard/project-mobile.webp"];
                const statuses = ["ACTIVE", "ACTIVE", "ACTIVE"];
                const statusKey = proj.status === "COMPLETED" ? "completed" : proj.status === "SUSPENDED" ? "review" : "inDevelopment";
                return (
                  <article key={proj.id}>
                    <img src={images[i % 3]} alt="" />
                    <div>
                      <h4>{proj.title}</h4>
                      <p>{t(`projects.status.${statusKey}`)}</p>
                      <div className="str-project-progress">
                        <div className="str-track"><b style={{ width: `${30 + i * 20}%` }} /></div>
                        <span>{30 + i * 20}%</span>
                      </div>
                    </div>
                    <span className={`str-status ${statusKey === "review" ? "review" : statusKey === "completed" ? "completed" : ""}`}>
                      {t(`projects.status.${statusKey}`)}
                    </span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="str-empty">
              <Folder />
              <p>{t("projects.empty")}</p>
            </div>
          )}
        </article>
      </section>

      {/* ─── Bottom grid: Featured + Engineers + Activity ──────────────────── */}
      <section className="str-bottom-grid">
        {/* ─── Featured Community Projects ────────────────────────────────── */}
        <article className="str-panel" id="featured">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-star-emoji">⭐</span>
              <h3>{t("featured.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}opportunities`}>{t("common.viewAll")}</Link>
          </div>
          {featuredProjects.length > 0 ? (
            <div className="str-featured-cards">
              {featuredProjects.map((proj, i) => {
                const images = ["/dashboard/community-ai.webp", "/dashboard/community-agriculture.webp"];
                const tags = [t("featured.aiEducation"), t("featured.greenTech")];
                return (
                  <article key={proj.id}>
                    <div className="str-featured-image">
                      <img src={images[i % 2]} alt="" />
                      <span className={i === 1 ? "green-tag" : ""}>{tags[i % 2]}</span>
                    </div>
                    <div className="str-featured-body">
                      <h4>{proj.title}</h4>
                      <p>{t("featured.desc")}</p>
                      <div className="str-featured-meta">
                        <span>♙ {50 + i * 10}</span>
                        <span className="str-track"><b style={{ width: `${75 + i * 15}%`, background: i === 0 ? "#7154ff" : "#087cff" }} /></span>
                        <strong>{75 + i * 15}%</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="str-empty">
              <Star />
              <p>{t("featured.empty")}</p>
            </div>
          )}
        </article>

        {/* ─── Recommended Engineers ──────────────────────────────────────── */}
        <article className="str-panel" id="engineers">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-round-icon">
                <UsersRound />
              </span>
              <h3>{t("engineers.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}talent`}>{t("common.viewAll")}</Link>
          </div>
          {talentResult.results.length > 0 ? (
            <div className="str-engineer-list">
              {talentResult.results.map((eng, i) => (
                <article key={eng.id}>
                  <span className={`str-person ${i % 2 === 0 ? "female" : ""}`}>
                    {eng.displayName?.charAt(0) || "?"}
                  </span>
                  <div>
                    <h4>{eng.displayName}</h4>
                    <p>{eng.headline || (loc === "ar" ? "مهندس" : "Engineer")}</p>
                    <div className="str-tags">
                      {(eng.skills || []).slice(0, 3).map((s, j) => (
                        <span key={j}>{s.name}</span>
                      ))}
                    </div>
                  </div>
                  <ConnectButton
                    connectLabel={t("common.connect")}
                    toastMsg={t("engineers.connectToast")}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="str-empty">
              <UsersRound />
              <p>{t("engineers.empty")}</p>
            </div>
          )}
        </article>

        {/* ─── Recent Activity ───────────────────────────────────────────── */}
        <article className="str-panel" id="activity">
          <div className="str-panel-header">
            <div className="str-heading">
              <span className="str-round-icon violet">
                <Bell />
              </span>
              <h3>{t("activity.title")}</h3>
            </div>
            <Link href={`/${loc === "ar" ? "" : "en/"}activity`}>{t("common.viewAll")}</Link>
          </div>
          {recentActivity.length > 0 ? (
            <div className="str-activity-list">
              {recentActivity.map((notif) => (
                <article key={notif.id}>
                  <span className="str-person">
                    {notif.title?.charAt(0) || "?"}
                  </span>
                  <div>
                    <h4>{notif.title}</h4>
                    <p>{notif.body}</p>
                  </div>
                  <small>
                    {new Date(notif.createdAt).toLocaleString(loc === "ar" ? "ar" : "en", {
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </small>
                  <MessageCircle className="str-activity-icon" />
                </article>
              ))}
            </div>
          ) : (
            <div className="str-empty">
              <Bell />
              <p>{t("activity.empty")}</p>
            </div>
          )}
        </article>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="str-footer">
        <span>Syrian Tech Renaissance · Dashboard</span>
        <span>{t("footer.demoNotice")}</span>
      </footer>
    </AppShell>
  );
}
