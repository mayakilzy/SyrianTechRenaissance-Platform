"use client";

import { useState, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Search, RotateCcw, Grid3x3, List } from "lucide-react";

export interface OpportunityItem {
  id: string;
  title: string;
  orgName: string;
  location: string;
  type: string; // "fulltime" | "freelance" | "volunteer" | "collaborative"
  field: string; // "ai" | "web" | "agri" | "education" | "other"
  experience: string; // "entry" | "mid" | "senior" | "all"
  daysAgo: number;
  applicants: number;
  tags: string[];
  image: string;
  isRemote: boolean;
}

type ViewMode = "grid" | "list";

export function OpportunitiesExplorer({
  opportunities,
  stats,
  postHref,
}: {
  opportunities: OpportunityItem[];
  stats: { total: number; organizations: number; engineersNeeded: number; international: number; freelance: number; volunteer: number };
  postHref: string;
}) {
  const t = useTranslations("jobOpps");
  const locale = useLocale() as "ar" | "en";
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (category !== "all" && o.type !== category) return false;
      if (typeFilter !== "all" && o.type !== typeFilter) return false;
      if (fieldFilter !== "all" && o.field !== fieldFilter) return false;
      if (experienceFilter !== "all" && o.experience !== experienceFilter) return false;
      if (locationFilter !== "all") {
        if (locationFilter === "remote" && !o.isRemote) return false;
        if (locationFilter !== "remote" && !o.location.toLowerCase().includes(locationFilter.toLowerCase())) return false;
      }
      if (q) {
        const haystack = (o.title + " " + o.orgName + " " + o.tags.join(" ")).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [opportunities, category, query, typeFilter, fieldFilter, experienceFilter, locationFilter]);

  const categoryCounts = {
    all: opportunities.length,
    fulltime: opportunities.filter((o) => o.type === "fulltime").length,
    freelance: opportunities.filter((o) => o.type === "freelance").length,
    volunteer: opportunities.filter((o) => o.type === "volunteer").length,
    collaborative: opportunities.filter((o) => o.type === "collaborative").length,
  };

  const resetFilters = () => {
    setCategory("all");
    setQuery("");
    setLocationFilter("all");
    setTypeFilter("all");
    setFieldFilter("all");
    setExperienceFilter("all");
  };

  const toggleSave = (id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pillCategories = [
    { key: "all", label: t("pills.all"), count: categoryCounts.all },
    { key: "fulltime", label: t("pills.fulltime"), count: categoryCounts.fulltime },
    { key: "freelance", label: t("pills.freelance"), count: categoryCounts.freelance },
    { key: "volunteer", label: t("pills.volunteer"), count: categoryCounts.volunteer },
    { key: "collaborative", label: t("pills.collaborative"), count: categoryCounts.collaborative },
  ];

  const statValues = [
    { value: stats.total, label: t("statLabels.total") },
    { value: stats.organizations, label: t("statLabels.organizations") },
    { value: stats.engineersNeeded, label: t("statLabels.engineersNeeded") },
    { value: stats.international, label: t("statLabels.international") },
    { value: stats.freelance, label: t("statLabels.freelance") },
    { value: stats.volunteer, label: t("statLabels.volunteer") },
  ];

  const statIcons = ["\u25A3", "\u25E5", "\u2659", "\u25CE", "\u26DF", "\u2661"];
  const badgeMap: Record<string, string> = {
    fulltime: t("badges.fulltime"),
    freelance: t("badges.freelance"),
    collaborative: t("badges.collaborative"),
    volunteer: t("badges.volunteer"),
  };
  const heroLinks = [
    { key: "fulltime", label: t("links.fulltime") },
    { key: "freelance", label: t("links.freelance") },
    { key: "volunteer", label: t("links.volunteer") },
    { key: "collaborative", label: t("links.collaborative") },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-copy">
          <h1><span className="hero-icon">{"\u25A3"}</span><span>{t("title")}</span></h1>
          <h2>{t("subtitle")}</h2>
          <p>{t("intro")}</p>
          <div className="hero-buttons">
            <Link href={postHref} className="gradient-btn">
              <span>{t("post")}</span> {"\uFF0B"}
            </Link>
            <button className="outline-btn" onClick={() => document.getElementById("opportunities")?.scrollIntoView({ behavior: "smooth" })}>
              <span>{t("explore")}</span> {"\u2315"}
            </button>
          </div>
        </div>
        <div className="holo">
          <div className="holo-head">
            <small>{t("together")}</small>
            <strong>{t("holo")}</strong>
          </div>
          <div className="network">{"\u2735\u2301\u25C7"}</div>
        </div>
        <div className="hero-links">
          {heroLinks.map((link) => (
            <button key={link.key} onClick={() => { setCategory(link.key); document.getElementById("opportunities")?.scrollIntoView({ behavior: "smooth" }); }}>
              <span>{"\u2667"}</span>{link.label}
            </button>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="stats" aria-label="Opportunity statistics">
        {statValues.map((stat, i) => (
          <article key={i} className="stat">
            <span className="stat-icon">{statIcons[i]}</span>
            <div>
              <strong>{stat.value}</strong>
              <small>{stat.label}</small>
            </div>
          </article>
        ))}
      </section>

      {/* Filters */}
      <section className="filter-panel">
        <div className="pills">
          {pillCategories.map((pill) => (
            <button
              key={pill.key}
              className={`pill ${category === pill.key ? "active" : ""}`}
              onClick={() => setCategory(pill.key)}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
        </div>
        <div className="filter-tools">
          <label className="op-search">
            <Search />
            <input
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search opportunities"
            />
          </label>
          <label className="select">
            <small>{t("location")}</small>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
              <option value="all">{t("locations.all")}</option>
              <option value="remote">{t("locations.remote")}</option>
              <option value="syria">{t("locations.syria")}</option>
              <option value="istanbul">{t("locations.istanbul")}</option>
              <option value="international">{t("locations.international")}</option>
            </select>
          </label>
          <label className="select">
            <small>{t("jobType")}</small>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">{t("types.all")}</option>
              <option value="fulltime">{t("types.fulltime")}</option>
              <option value="freelance">{t("types.freelance")}</option>
              <option value="volunteer">{t("types.volunteer")}</option>
              <option value="collaborative">{t("types.collaborative")}</option>
            </select>
          </label>
          <label className="select">
            <small>{t("field")}</small>
            <select value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)}>
              <option value="all">{t("fields.all")}</option>
              <option value="ai">{t("fields.ai")}</option>
              <option value="web">{t("fields.web")}</option>
              <option value="agri">{t("fields.agri")}</option>
              <option value="education">{t("fields.education")}</option>
            </select>
          </label>
          <label className="select experience">
            <small>{t("experience")}</small>
            <select value={experienceFilter} onChange={(e) => setExperienceFilter(e.target.value)}>
              <option value="all">{t("experiences.all")}</option>
              <option value="entry">{t("experiences.entry")}</option>
              <option value="mid">{t("experiences.mid")}</option>
              <option value="senior">{t("experiences.senior")}</option>
            </select>
          </label>
          <button className="icon-btn" title={t("resetFilters")} onClick={resetFilters}>
            <RotateCcw />
          </button>
          <div className="view-controls">
            <button
              className={view === "grid" ? "selected" : ""}
              aria-label="Grid view"
              onClick={() => setView("grid")}
            >
              <Grid3x3 />
            </button>
            <button
              className={view === "list" ? "selected" : ""}
              aria-label="List view"
              onClick={() => setView("list")}
            >
              <List />
            </button>
          </div>
        </div>
      </section>

      {/* Opportunity cards */}
      <section id="opportunities" className={`cards ${view === "list" ? "list-mode" : ""}`} aria-live="polite">
        {filtered.length > 0 ? (
          filtered.map((o) => (
            <article key={o.id} className="op-card">
              <div className="card-top">
                <img className="card-image" src={o.image} alt="" />
                <div className="card-body">
                  <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                    <span className={`type-badge ${o.type}`}>{badgeMap[o.type] || o.type}</span>
                    <button
                      className={`save ${saved.has(o.id) ? "saved" : ""}`}
                      onClick={() => toggleSave(o.id)}
                      aria-label="Save opportunity"
                      aria-pressed={saved.has(o.id)}
                    >
                      {saved.has(o.id) ? "\u2665" : "\u2667"}
                    </button>
                  </div>
                  <h3 className="card-title">{o.title}</h3>
                  <span className="card-org">{o.orgName}</span>
                  <span className="card-loc">{"\u2667"} {o.location}</span>
                </div>
              </div>
              <div className="tags">
                {o.tags.map((tag, j) => (
                  <span key={j} className="tag">{tag}</span>
                ))}
              </div>
              <div className="card-footer">
                <div className="card-meta">
                  <span>{"\u25A3"} {locale === "ar" ? `${t("ago")} ${o.daysAgo} ${t("days")}` : `${o.daysAgo} ${t("days")}`}</span>
                  <span>{"\u2659"} {o.applicants} {t("applicants")}</span>
                </div>
                <Link href={`/${locale === "ar" ? "" : "en/"}opportunities/${o.id}`} className="details">
                  {t("details")} {"\u2192"}
                </Link>
              </div>
            </article>
          ))
        ) : (
          <div className="empty">{t("noResults")}</div>
        )}
      </section>

      <footer>
        <span>STR {"\u2014"} Syrian Tech Renaissance</span>
        <span>{t("disclaimer")}</span>
      </footer>
    </>
  );
}
