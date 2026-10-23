"use client";

import { useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Search, Grid3x3, List, RotateCcw } from "lucide-react";

export interface ProjectItem {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed" | "hold" | "draft";
  progress: number;
  members: number;
  openTasks: number;
  updatedAt: string;
  tags: string[];
  image: string;
  teamMembers: { id: string; initial: string; displayName: string }[];
  projectType: string;
}

type SortKey = "recent" | "old" | "progress" | "name";
type ViewMode = "grid" | "list";

export function ProjectsExplorer({
  projects,
  stats,
  createHref,
  exploreHref,
}: {
  projects: ProjectItem[];
  stats: { total: number; active: number; completed: number; hold: number; members: number; contributions: number };
  createHref: string;
  exploreHref: string;
}) {
  const t = useTranslations("myProjects");
  const locale = useLocale() as "ar" | "en";
  const [tab, setTab] = useState<"all" | "active" | "completed" | "hold" | "draft">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<ViewMode>("grid");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => {
      if (tab !== "all" && p.status !== tab) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (typeFilter !== "all" && p.projectType !== typeFilter) return false;
      if (q && !p.title.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q) && !p.tags.some((tag) => tag.toLowerCase().includes(q))) return false;
      return true;
    });
    list = list.sort((a, b) => {
      if (sort === "progress") return b.progress - a.progress;
      if (sort === "name") return a.title.localeCompare(b.title, locale === "ar" ? "ar" : "en");
      if (sort === "old") return a.updatedAt.localeCompare(b.updatedAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return list;
  }, [projects, tab, query, sort, typeFilter, statusFilter, locale]);

  const counts = {
    all: projects.length,
    active: projects.filter((p) => p.status === "active").length,
    completed: projects.filter((p) => p.status === "completed").length,
    hold: projects.filter((p) => p.status === "hold").length,
    draft: projects.filter((p) => p.status === "draft").length,
  };

  const resetFilters = () => {
    setTab("all");
    setQuery("");
    setSort("recent");
    setTypeFilter("all");
    setStatusFilter("all");
  };

  const tabs = [
    { key: "all" as const, label: t("tabs.all"), count: counts.all },
    { key: "active" as const, label: t("tabs.active"), count: counts.active },
    { key: "completed" as const, label: t("tabs.completed"), count: counts.completed },
    { key: "hold" as const, label: t("tabs.hold"), count: counts.hold },
    { key: "draft" as const, label: t("tabs.draft"), count: counts.draft },
  ];

  const statsArr = [
    { value: stats.total, label: t("stats.total") },
    { value: stats.active, label: t("stats.active") },
    { value: stats.completed, label: t("stats.completed") },
    { value: stats.hold, label: t("stats.hold") },
    { value: stats.members, label: t("stats.members") },
    { value: stats.contributions, label: t("stats.contributions") },
  ];

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      active: t("status.active"),
      completed: t("status.completed"),
      hold: t("status.hold"),
      draft: t("status.draft"),
    };
    return map[s] || s;
  };
  const statusIcon = (s: string) => {
    if (s === "completed") return "✓";
    if (s === "hold") return "Ⅱ";
    return "✦";
  };

  return (
    <>
      {/* Hero */}
      <section className="mp-hero" aria-labelledby="page-title">
        <div className="mp-hero-scene" aria-hidden="true" />
        <div className="mp-hero-vignette" aria-hidden="true" />
        <div className="mp-hero-content">
          <h1 id="page-title">
            <span className="mp-title-icon">▱</span>
            <span>{t("title")}</span>
          </h1>
          <h2>{t("heroSubtitle")}</h2>
          <p>{t("heroDescription")}</p>
          <div className="mp-hero-buttons">
            <Link href={createHref} className="mp-primary-button">
              <span>{t("create")}</span> ＋
            </Link>
            <Link href={exploreHref} className="mp-outline-button">
              <span>{t("explore")}</span> ⌕
            </Link>
          </div>
        </div>
        <div className="mp-hero-hologram">
          <b>{t("holoTitle")}</b>
          <span className="mp-holo-network">◇⌁◇</span>
          <small>♙ Plan<br />♧ Collaborate<br />♙ Build<br />▥ Make Impact</small>
        </div>
      </section>

      {/* Stats */}
      <section className="mp-stats" aria-label={t("statsAria")}>
        {statsArr.map((stat, i) => (
          <article key={i} className="mp-stat">
            <span className="mp-stat-icon">
              {i === 0 && <span>⬡</span>}
              {i === 1 && <span>▷</span>}
              {i === 2 && <span>✓</span>}
              {i === 3 && <span>Ⅱ</span>}
              {i === 4 && <span>♙</span>}
              {i === 5 && <span>★</span>}
            </span>
            <span>
              <strong>{stat.value}</strong>
              <small>{stat.label}</small>
            </span>
          </article>
        ))}
      </section>

      {/* Filters */}
      <section className="mp-filters" aria-label={t("filtersAria")}>
        <div className="mp-tabs">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              className={`mp-tab ${tab === tb.key ? "active" : ""}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label} ({tb.count})
            </button>
          ))}
        </div>
        <div className="mp-filter-controls">
          <label className="mp-project-search">
            <Search />
            <input
              placeholder={t("projectSearch")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="mp-select-wrap">
            <small>{t("sortLabel")}</small>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="recent">{t("sorts.recent")}</option>
              <option value="old">{t("sorts.old")}</option>
              <option value="progress">{t("sorts.progress")}</option>
              <option value="name">{t("sorts.name")}</option>
            </select>
          </label>
          <label className="mp-select-wrap">
            <small>{t("typeLabel")}</small>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">{t("types.all")}</option>
              <option value="education">{t("types.education")}</option>
              <option value="agriculture">{t("types.agriculture")}</option>
              <option value="government">{t("types.government")}</option>
              <option value="robotics">{t("types.robotics")}</option>
              <option value="knowledge">{t("types.knowledge")}</option>
              <option value="energy">{t("types.energy")}</option>
            </select>
          </label>
          <label className="mp-select-wrap">
            <small>{t("statusLabel")}</small>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{t("status.all")}</option>
              <option value="active">{t("status.active")}</option>
              <option value="completed">{t("status.completed")}</option>
              <option value="hold">{t("status.hold")}</option>
              <option value="draft">{t("status.draft")}</option>
            </select>
          </label>
          <button
            className="mp-icon-button"
            onClick={resetFilters}
            title={t("resetFilters")}
            aria-label={t("resetFilters")}
          >
            <RotateCcw />
          </button>
          <div className="mp-view-switch">
            <button
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
              aria-label={t("gridView")}
            >
              <Grid3x3 />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
              aria-label={t("listView")}
            >
              <List />
            </button>
          </div>
        </div>
      </section>

      {/* Projects grid */}
      <section className={`mp-projects-grid ${view === "list" ? "list-mode" : ""}`} aria-live="polite">
        {filtered.length > 0 ? (
          filtered.map((p) => (
            <article key={p.id} className="mp-project-card">
              <div className="mp-project-image-col">
                <img className="mp-project-image" src={p.image} alt="" />
                <div className="mp-members">
                  {p.teamMembers.slice(0, 3).map((m) => (
                    <span key={m.id} className="mp-member-avatar" title={m.displayName}>
                      {m.initial}
                    </span>
                  ))}
                  {p.members > 3 && (
                    <span className="mp-member-avatar mp-member-extra">+{p.members - 3}</span>
                  )}
                </div>
              </div>
              <div className="mp-project-body">
                <div className="mp-project-heading">
                  <div>
                    <h3 className="mp-project-title">{p.title}</h3>
                    <p className="mp-project-desc">{p.description}</p>
                  </div>
                  <div>
                    <div className={`mp-project-status ${p.status}`}>
                      {statusLabel(p.status)} {statusIcon(p.status)}
                    </div>
                    <div className="mp-project-updated">
                      {t("updated")} {new Date(p.updatedAt).toLocaleDateString(locale === "ar" ? "ar" : "en")}
                    </div>
                  </div>
                </div>
                <div className="mp-tags">
                  {p.tags.map((tag, j) => (
                    <span key={j} className="mp-tag">{tag}</span>
                  ))}
                </div>
                <div className="mp-progress-line">
                  <div className="mp-progress-track">
                    <div className="mp-progress-fill" style={{ width: `${p.progress}%` }} />
                  </div>
                  <b>{p.progress}%</b>
                </div>
                <div className="mp-project-bottom">
                  <div className="mp-project-meta">
                    <span>♧ {p.openTasks} {t("tasks")}</span>
                    <span>♙ {p.members} {t("members")}</span>
                  </div>
                  <Link href={`/${locale === "ar" ? "" : "en/"}projects/${p.id}`} className="mp-detail-btn">
                    {t("details")}
                  </Link>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="mp-empty">
            <Search />
            {t("noResults")}
          </div>
        )}
      </section>

      <footer className="mp-page-footer">
        <span>STR · Syrian Tech Renaissance</span>
        <span>{t("demoNotice")}</span>
      </footer>
    </>
  );
}
