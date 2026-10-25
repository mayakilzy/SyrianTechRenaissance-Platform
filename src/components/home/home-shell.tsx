"use client";

/**
 * STR UI-01 — Home Shell (client component)
 *
 * Source: STR_UI_01_HOME_REFERENCE_v1.2 (SHA-256 58835abdb30ce0c2b33f858faf88c57279092fb1180da69dc7a0e423660b641a)
 *
 * Faithful React port of the approved Page 01 v1.2 visual reference:
 *   - Same dark futuristic palette (bg #030a16, panel #07192d, cyan #00c7ff, blue #087bff, purple #8a2eff)
 *   - Same layout (198px sidebar + 1fr main, 76px topbar, hero, stats, feature-grid, lower-grid, footer)
 *   - Same responsive breakpoints (1350/900/640px)
 *   - Same R1 Tajawal typography (via next/font/google) + IBM Plex Sans for Latin
 *   - Same R4 inline-SVG icon system (here rendered via lucide-react for React idiom)
 *   - Same R5 mobile EN-LTR overflow fix
 *   - Same D1-D4 SVG sizing fix (scoped under .str-home)
 *
 * Adaptations from v1.2 source:
 *   - Demo banner → "Beta platform" status banner (truthful)
 *   - Language toggle uses Next.js routing (not JS DOM manipulation)
 *   - Sidebar links to REAL routes only (per Batch 01 audit):
 *     /dashboard, /my-projects, /opportunities, /talent, /organizations,
 *     /partnerships, /integrations, /proposals
 *   - "Learning", "Events", "Messages", "AI Assistant" sections that have no
 *     real backend are marked as "coming soon" with disabled state (no fake data)
 *   - Stats use REAL counts passed as props (engineers, projects, opportunities)
 *   - Featured projects use REAL active projects passed as props
 *   - "Featured engineers" and "Recent activity" sections show "coming soon"
 *     (no public engineer profile API; activity is user-specific)
 *   - Heritage card CTA links to /dashboard (NOT /mission which is missing)
 *   - AI input button marked `disabled` (no AI assistant implemented)
 *   - Profile widget shows real user name if authenticated, "Guest" + signin link if not
 */

import { Tajawal, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useState, useCallback } from "react";
import {
  Star, Search, Bell, Home, Folder, Users, Pencil, Briefcase,
  GraduationCap, Sparkles, CalendarDays, MessageSquare, ArrowRight,
  ChevronRight, Plus, CircleDot, Menu, X, Globe, ShieldCheck, Lock,
} from "lucide-react";
import "./home.css";

// ─── R1: Tajawal (Arabic) + IBM Plex Sans (Latin) via next/font/google ────────
const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

const ibmPlex = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// ─── Props ──────────────────────────────────────────────────────────────────
export interface HomeShellProps {
  // Real platform stats (passed from server component, never fabricated)
  stats: {
    engineers: number;
    activeProjects: number;
    contributionsThisMonth: number;
    openOpportunities: number;
    upcomingEvents: number; // 0 — no events API; show "—" honestly
  };
  // Real featured projects (top 3 ACTIVE projects from DB)
  featuredProjects: Array<{
    id: string;
    title: string;
    description: string;
    tags: string[];
    progress: number; // 0–100 — 0 if no real progress data
    statusBadge: "open" | "seeking" | "inProgress"; // mapped from project status
    imageKey: "education" | "health" | "city"; // cycles through available images
  }>;
  // Auth-aware profile widget
  profile: {
    isAuthenticated: boolean;
    displayName?: string;
    initials?: string;
    roleLabel?: string;
  };
}

// ─── Component ──────────────────────────────────────────────────────────────
export function HomeShell({ stats, featuredProjects, profile }: HomeShellProps) {
  const t = useTranslations("home");
  const locale = useLocale() as "ar" | "en";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ─── Locale switching via Next.js routing ─────────────────────────────────
  // next-intl "as-needed" prefix: ar = "/", en = "/en"
  const switchLocale = () => {
    const target = locale === "ar" ? "en" : "ar";
    const path = target === "ar" ? "/" : "/en";
    window.location.href = path;
  };

  // ─── Prefix for locale-aware links ────────────────────────────────────────
  // ar uses default prefix (no /ar), en uses /en
  const L = locale === "ar" ? "" : "en/";
  const link = (href: string) => `/${L}${href}`;

  // ─── Sidebar nav: REAL routes only (per Batch 01 audit) ────────────────────
  // v1.2 had #home, #projects, #community, #engineers, #opportunities, #learning,
  // #assistant, #events, #activity. We map to real routes:
  //   #home → "/" (current page)
  //   #projects → /opportunities (published projects for contribution)
  //   #community → /organizations
  //   #engineers → /talent
  //   #opportunities → /opportunities (same as projects)
  //   #learning, #assistant, #events, #activity → no real route → marked "coming soon"
  const navLinks = [
    { href: "", icon: Home, label: t("nav.home"), active: true },
    { href: "opportunities", icon: Folder, label: t("nav.projects") },
    { href: "organizations", icon: Users, label: t("nav.community") },
    { href: "talent", icon: Pencil, label: t("nav.engineers") },
    { href: "opportunities", icon: Briefcase, label: t("nav.opportunities") },
    // Learning has no real route — show as "coming soon" but still clickable to
    // an honest state. Mark with `comingSoon: true` and route to nowhere.
    { href: "__coming_soon__", icon: GraduationCap, label: t("nav.learning"), comingSoon: true },
    { href: "__coming_soon__", icon: Sparkles, label: t("nav.ai"), comingSoon: true },
    { href: "__coming_soon__", icon: CalendarDays, label: t("nav.events"), comingSoon: true },
    { href: "__coming_soon__", icon: MessageSquare, label: t("nav.messages"), comingSoon: true },
  ];

  // ─── Workspace links (auth-gated) ─────────────────────────────────────────
  const workspaceLinks = profile.isAuthenticated
    ? [
        { href: "my-projects", label: t("workspace.personal"), color: "violet" },
        { href: "my-projects", label: t("workspace.joined"), color: "blue" },
        { href: "proposals", label: t("workspace.proposed"), color: "green" },
        { href: "my-projects", label: t("workspace.favorites"), color: "orange" },
      ]
    : []; // For unauthenticated: heritage card prompts signin, workspaces hidden

  // ─── Stat items (5) — use REAL counts from props ──────────────────────────
  const statItems = [
    { icon: Users, value: stats.engineers, label: t("stats.engineers") },
    { icon: Folder, value: stats.activeProjects, label: t("stats.activeProjects") },
    { icon: ArrowRight, value: stats.contributionsThisMonth, label: t("stats.contributions") },
    { icon: Briefcase, value: stats.openOpportunities, label: t("stats.opportunities") },
    { icon: CalendarDays, value: stats.upcomingEvents, label: t("stats.events") },
  ];

  // ─── AI chips (kept as v1.2 demo with translated labels) ─────────────────
  const aiChips = [
    t("ai.chip1"), t("ai.chip2"), t("ai.chip3"),
    t("ai.chip4"), t("ai.chip5"), t("ai.chip6"),
  ];

  // ─── Category grid (kept as v1.2 — links to /opportunities) ────────────────
  const categories = [
    { icon: Sparkles, label: t("category.ai") },
    { icon: Folder, label: t("category.web") },
    { icon: ArrowRight, label: t("category.data") },
    { icon: Home, label: t("category.infra") },
    { icon: GraduationCap, label: t("category.education") },
    { icon: CircleDot, label: t("category.more") },
  ];

  // ─── Learning levels ──────────────────────────────────────────────────────
  const learningLevels = [t("learning.beginner"), t("learning.intermediate"), t("learning.advanced")];

  return (
    <div
      className={`str-home ${tajawal.variable} ${ibmPlex.variable}`}
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
    >
      {/* ─── Status banner (repurposed demo banner — truthful "Beta") ─── */}
      <div className="demo-banner" role="note">
        <span>{t("demoBanner.text")}</span>
        <button
          type="button"
          aria-label={t("demoBanner.switchLangAria")}
          onClick={switchLocale}
        >
          {locale === "ar" ? "EN / AR" : "AR / EN"}
        </button>
      </div>

      {/* ─── App shell ─── */}
      <div className="app-shell">
        {/* ─── Topbar ─── */}
        <header className="topbar">
          <Link className="brand" href={link("")} aria-label={t("brand.aria")}>
            <span className="brand-mark">
              <Star size={22} strokeWidth={2} aria-hidden="true" />
              <strong>STR</strong>
            </span>
            <span className="brand-text">
              <span className="brand-name">Syrian Tech Renaissance</span>
              <small>{t("brand.subtitle")}</small>
            </span>
          </Link>

          <div className="search">
            <Search className="ico" aria-hidden="true" />
            <span>{t("search.placeholder")}</span>
            <kbd>⌘ K</kbd>
          </div>

          <div className="header-tools">
            <span className="notification" aria-label={t("notifications.aria")}>
              <Bell aria-hidden="true" />
              <b>3</b>
            </span>
            {profile.isAuthenticated ? (
              <Link
                href={link("profile")}
                className="profile-link"
                aria-label={t("profile.signedInAria")}
              >
                <span className="avatar" aria-hidden="true">{profile.initials || "U"}</span>
                <span className="profile">
                  <span>{profile.displayName || t("profile.user")}</span>
                  <small>{profile.roleLabel || t("profile.user")}</small>
                </span>
              </Link>
            ) : (
              <Link
                href={locale === "ar" ? "/auth/signin" : "/en/auth/signin"}
                className="profile-link"
                aria-label={t("profile.guestAria")}
              >
                <span className="avatar" aria-hidden="true">
                  <Lock size={16} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="profile">
                  <span>{t("profile.guest")}</span>
                  <small>{t("profile.guestSubtitle")}</small>
                </span>
              </Link>
            )}
            <button
              type="button"
              className="icon-btn str-mobile-menu"
              aria-label={t("menu.openAria")}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* ─── Sidebar ─── */}
        <aside
          className={`sidebar ${sidebarOpen ? "open" : ""}`}
          aria-label={t("nav.aria")}
        >
          <div className="sidebar-mobile-brand">
            STR
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label={t("menu.closeAria")}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <nav className="main-nav">
            {navLinks.map((n, i) =>
              n.comingSoon ? (
                <button
                  key={i}
                  type="button"
                  className={`str-nav-link ${n.active ? "active" : ""}`}
                  onClick={() => showToast(t("comingSoon.toast"))}
                  aria-label={`${n.label} — ${t("comingSoon.aria")}`}
                >
                  <n.icon aria-hidden="true" />
                  <em>{n.label}</em>
                  <small className="coming-soon-tag" aria-hidden="true">{t("comingSoon.short")}</small>
                </button>
              ) : (
                <Link
                  key={i}
                  className={`str-nav-link ${n.active ? "active" : ""}`}
                  href={link(n.href)}
                  onClick={() => setSidebarOpen(false)}
                >
                  <n.icon aria-hidden="true" />
                  <em>{n.label}</em>
                </Link>
              )
            )}
          </nav>

          {/* ─── Workspaces (auth-gated) ─── */}
          {profile.isAuthenticated && workspaceLinks.length > 0 && (
            <>
              <div className="sidebar-title">
                <span>{t("workspace.title")}</span>
                <Plus aria-hidden="true" />
              </div>
              <nav className="work-nav">
                {workspaceLinks.map((w, i) => (
                  <Link
                    key={i}
                    href={link(w.href)}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className={`dot dot-${w.color}`} aria-hidden="true" />
                    <span>{w.label}</span>
                  </Link>
                ))}
              </nav>
            </>
          )}

          {/* ─── Heritage card ─── */}
          <div className="heritage-card">
            <h3>{t("heritage.title")}</h3>
            <Link
              href={link("dashboard")}
              onClick={() => setSidebarOpen(false)}
            >
              {t("heritage.cta")}
            </Link>
          </div>
        </aside>

        {/* ─── Main content ─── */}
        <main id="home">
          {/* ─── Hero ─── */}
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow">{t("hero.eyebrow")}</p>
              <h1 id="hero-title">{t("hero.title")}</h1>
              <p>{t("hero.subtitle")}</p>
              <div className="hero-actions">
                <Link href={link("opportunities")} className="btn primary">
                  <span>{t("hero.ctaPrimary")}</span>
                  <ArrowRight className="ico" aria-hidden="true" />
                </Link>
                <Link href={link("organizations")} className="btn outline">
                  <Users className="ico" aria-hidden="true" />
                  <span>{t("hero.ctaSecondary")}</span>
                </Link>
              </div>
            </div>

            <div className="hero-art" aria-hidden="true">
              <div className="hologram">
                <b>AI</b>
                <span>{t("hologram.ideas")}</span>
                <span>{t("hologram.solutions")}</span>
                <span>{t("hologram.impact")}</span>
                <div className="network" aria-hidden="true">✧ ── ◇ ── ✧</div>
              </div>
              <div className="holo-label">
                <span>
                  <Home className="ico-sm" aria-hidden="true" />
                  <span>{t("holoLabel.build")}</span>
                </span>
                <span>
                  <Users className="ico-sm" aria-hidden="true" />
                  <span>{t("holoLabel.collaborate")}</span>
                </span>
                <span>
                  <GraduationCap className="ico-sm" aria-hidden="true" />
                  <span>{t("holoLabel.learn")}</span>
                </span>
                <span>
                  <ArrowRight className="ico-sm" aria-hidden="true" />
                  <span>{t("holoLabel.grow")}</span>
                </span>
              </div>
            </div>

            <div className="hero-quote">
              <span>{t("hero.quote")}</span>
            </div>
          </section>

          {/* ─── Stats (5 — real counts) ─── */}
          <section className="stats" aria-label={t("stats.aria")}>
            {statItems.map((s, i) => (
              <div className="stat" key={i}>
                <i>
                  <s.icon aria-hidden="true" />
                </i>
                <div>
                  <strong>{s.value > 0 ? s.value.toLocaleString(locale) : "—"}</strong>
                  <span>{s.label}</span>
                </div>
              </div>
            ))}
          </section>

          {/* ─── Feature grid (3 panels: AI / Explore / Learning) ─── */}
          <section className="feature-grid">
            {/* AI panel — demo only, disabled */}
            <article className="panel ai-panel" id="assistant">
              <div className="feature-heading">
                <div className="glow-icon">
                  <Sparkles aria-hidden="true" />
                </div>
                <div>
                  <h2>{t("ai.title")}</h2>
                  <p>{t("ai.subtitle")}</p>
                </div>
              </div>
              <div className="fake-input">
                <span>{t("ai.placeholder")}</span>
                <button type="button" aria-label={t("ai.demoOnlyAria")} disabled>
                  <ArrowRight size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="chips">
                {aiChips.map((c, i) => (
                  <span key={i}>{c}</span>
                ))}
              </div>
            </article>

            {/* Explore panel — links to /opportunities (real) */}
            <article className="panel explore-panel" id="projects">
              <div className="feature-heading">
                <div className="glow-icon">
                  <Search aria-hidden="true" />
                </div>
                <div>
                  <h2>{t("explore.title")}</h2>
                  <p>{t("explore.subtitle")}</p>
                </div>
              </div>
              <div className="category-grid">
                {categories.map((c, i) => (
                  <div key={i}>
                    <c.icon aria-hidden="true" />
                    <small>{c.label}</small>
                  </div>
                ))}
              </div>
              <Link href={link("opportunities")} className="btn primary small">
                <span>{t("explore.cta")}</span>
                <ChevronRight className="ico-sm" aria-hidden="true" />
              </Link>
            </article>

            {/* Learning panel — "coming soon" honestly */}
            <article className="panel learning-panel" id="learning">
              <div className="feature-heading">
                <div className="glow-icon">
                  <GraduationCap aria-hidden="true" />
                </div>
                <div>
                  <h2>{t("learning.title")}</h2>
                  <p>{t("learning.subtitle")}</p>
                </div>
              </div>
              <div className="levels">
                {learningLevels.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
              <div className="lesson">
                <span className="lesson-thumb">AI</span>
                <div>
                  <strong>{t("learning.comingSoon.title")}</strong>
                  <small>{t("learning.comingSoon.subtitle")}</small>
                </div>
                <ChevronRight aria-hidden="true" />
              </div>
              <div className="lesson">
                <span className="lesson-thumb blue">&lt;/&gt;</span>
                <div>
                  <strong>{t("learning.comingSoon.title2")}</strong>
                  <small>{t("learning.comingSoon.subtitle2")}</small>
                </div>
                <ChevronRight aria-hidden="true" />
              </div>
            </article>
          </section>

          {/* ─── Lower grid: Featured projects / Engineers / Activity ─── */}
          <section className="lower-grid">
            {/* Featured projects — REAL active projects */}
            <article className="panel featured" id="featured">
              <div className="section-heading">
                <h2>
                  <Star aria-hidden="true" />
                  <span>{t("featured.title")}</span>
                </h2>
                <Link href={link("opportunities")}>
                  <span>{t("featured.viewAll")}</span>
                  <ChevronRight className="ico-sm" aria-hidden="true" />
                </Link>
              </div>
              <div className="projects">
                {featuredProjects.length === 0 ? (
                  <div className="empty-state">
                    <span>{t("featured.empty")}</span>
                  </div>
                ) : (
                  featuredProjects.map((p, i) => {
                    const statusKey =
                      p.statusBadge === "open" ? "open"
                      : p.statusBadge === "seeking" ? "seeking"
                      : "inProgress";
                    return (
                      <Link key={p.id} href={link(`projects/${p.id}`)} className="project">
                        <div className={`project-img ${p.imageKey}`}>
                          <span>{t(`featured.status.${statusKey}`)}</span>
                        </div>
                        <h3>{p.title}</h3>
                        <p>{p.description}</p>
                        <div className="tags">
                          {p.tags.slice(0, 3).map((tag, j) => (
                            <span key={j}>{tag}</span>
                          ))}
                        </div>
                        <div className="progress">
                          <b style={{ width: `${p.progress}%` }} />
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </article>

            {/* Engineers — "coming soon" honestly (no public engineer profile API) */}
            <article className="panel engineers" id="engineers">
              <div className="section-heading">
                <h2>{t("engineers.title")}</h2>
                <Link href={link("talent")}>
                  <span>{t("engineers.viewAll")}</span>
                </Link>
              </div>
              <div className="empty-state-vertical">
                <Pencil aria-hidden="true" />
                <strong>{t("engineers.comingSoon.title")}</strong>
                <small>{t("engineers.comingSoon.subtitle")}</small>
                <Link href={link("talent")} className="btn primary small">
                  <span>{t("engineers.comingSoon.cta")}</span>
                </Link>
              </div>
            </article>

            {/* Activity — "coming soon" honestly (activity is user-specific) */}
            <article className="panel activity" id="activity">
              <div className="section-heading">
                <h2>{t("activity.title")}</h2>
                <Link href={profile.isAuthenticated ? link("dashboard") : (locale === "ar" ? "/auth/signin" : "/en/auth/signin")}>
                  <span>{t("activity.viewAll")}</span>
                </Link>
              </div>
              <div className="empty-state-vertical">
                <MessageSquare aria-hidden="true" />
                <strong>{t("activity.comingSoon.title")}</strong>
                <small>{t("activity.comingSoon.subtitle")}</small>
                {profile.isAuthenticated ? (
                  <Link href={link("dashboard")} className="btn primary small">
                    <span>{t("activity.comingSoon.cta")}</span>
                  </Link>
                ) : (
                  <Link href={locale === "ar" ? "/auth/signin" : "/en/auth/signin"} className="btn primary small">
                    <span>{t("activity.comingSoon.ctaGuest")}</span>
                  </Link>
                )}
              </div>
            </article>
          </section>

          {/* ─── Footer ─── */}
          <footer>
            <span>{t("footer.text")}</span>
          </footer>
        </main>
      </div>

      {/* ─── Toast for "coming soon" clicks ─── */}
      {toast && (
        <div className="str-toast show" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
