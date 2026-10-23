"use client";

import { Cairo, IBM_Plex_Sans } from "next/font/google";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useCallback } from "react";
import {
  House, Folder, BriefcaseBusiness, Blocks, UsersRound, Network,
  GraduationCap, CalendarDays, MessageSquare, Settings,
  Search, Bell, Globe, ChevronDown, Menu, X, Sun, Moon, Star,
} from "lucide-react";
import "./opportunities.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const ibmPlex = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export function OpportunitiesShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("jobOpps");
  const locale = useLocale() as "ar" | "en";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const navLinks = [
    { href: "dashboard", icon: House, label: t("nav.dashboard") },
    { href: "my-projects", icon: Folder, label: t("nav.myProjects") },
    { href: "opportunities", icon: BriefcaseBusiness, label: t("nav.jobOpportunities") },
    { href: "projects", icon: Blocks, label: t("nav.projects") },
    { href: "talent", icon: UsersRound, label: t("nav.engineers") },
    { href: "organizations", icon: Network, label: t("nav.community") },
    { href: "my-projects", icon: GraduationCap, label: t("nav.learning") },
    { href: "opportunities", icon: CalendarDays, label: t("nav.events") },
    { href: "opportunities", icon: MessageSquare, label: t("nav.messages") },
    { href: "settings", icon: Settings, label: t("nav.settings") },
  ];

  const switchLocale = () => {
    const target = locale === "ar" ? "en" : "ar";
    const path = target === "ar" ? "/" : "/en";
    window.location.href = path + "opportunities";
  };

  const hrefFor = (route: string) => {
    const prefix = locale === "ar" ? "/" : "/en/";
    return prefix + route;
  };

  return (
    <div className={`str04-shell ${cairo.variable} ${ibmPlex.variable} ${sidebarOpen ? "menu-open" : ""}`}>
      <header className="topbar">
        <button
          className="icon-btn mobile-menu"
          aria-label={t("openMenu")}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu />
        </button>
        <Link href={hrefFor("dashboard")} className="brand">
          <span className="logo"><i>✦</i>STR</span>
          <span className="brand-label">
            <strong>{t("brand")}</strong>
            <small>{t("brandTag")}</small>
          </span>
        </Link>
        <label className="global-search">
          <Search />
          <input
            placeholder={t("globalSearch")}
            onKeyDown={(e) => { if (e.key === "Enter") showToast(t("demoSearch")); }}
            aria-label="Global search"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="top-actions">
          <button className="icon-btn" title="Theme" onClick={showToast.bind(null, t("darkModeIsReference"))}>
            <Sun /><Moon />
          </button>
          <button className="language" aria-label={t("changeLanguage")} onClick={switchLocale}>
            <Globe /> <b>{locale.toUpperCase()}</b> <ChevronDown />
          </button>
          <button className="icon-btn bell" aria-label={t("notifications")} onClick={showToast.bind(null, t("demoNotifications"))}>
            <Bell /><em>5</em>
          </button>
          <span className="portrait">💻</span>
          <span className="user">
            <strong>{t("hello")}</strong>
            <small>{t("person")}</small>
          </span>
        </div>
      </header>

      <aside className="sidebar">
        <nav>
          {navLinks.map((link, i) => (
            <Link
              key={i}
              className={`nav-link ${i === 2 ? "active" : ""}`}
              href={hrefFor(link.href)}
              onClick={() => setSidebarOpen(false)}
            >
              <link.icon className="nav-icon" />
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-promo">
          <span className="promo-star">✦</span>
          <b>{t("promo")}</b>
          <button onClick={showToast.bind(null, t("joinToast"))}>{t("join")}</button>
        </div>
      </aside>
      <button className="scrim" aria-label={t("closeMenu")} onClick={() => setSidebarOpen(false)} />

      <main className="main">
        {children}
      </main>

      {toast && (
        <div className="str04-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
