"use client";

import { Cairo, IBM_Plex_Sans } from "next/font/google";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useCallback } from "react";
import {
  House, Folder, BriefcaseBusiness, Blocks, UsersRound, Network,
  GraduationCap, CalendarDays, MessageSquare, Settings,
  Search, Bell, Globe, ChevronDown, Menu, X, Sun, Moon,
  Briefcase as BriefcaseIcon, Users, Star, Building2,
} from "lucide-react";
import "./my-projects.css";

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

export function MyProjectsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("myProjects");
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
    { href: "opportunities", icon: BriefcaseBusiness, label: t("nav.workOpportunities") },
    { href: "projects", icon: Blocks, label: t("nav.projects") },
    { href: "talent", icon: UsersRound, label: t("nav.engineers") },
    { href: "organizations", icon: Network, label: t("nav.community") },
    { href: "learning", icon: GraduationCap, label: t("nav.learning") },
    { href: "events", icon: CalendarDays, label: t("nav.events") },
    { href: "messages", icon: MessageSquare, label: t("nav.messages") },
    { href: "settings", icon: Settings, label: t("nav.settings") },
  ];

  const workspaceLinks = [
    { href: "my-projects", icon: BriefcaseIcon, label: t("workspace.personalProjects") },
    { href: "talent", icon: Users, label: t("workspace.team") },
    { href: "projects", icon: Star, label: t("workspace.favorites") },
    { href: "organizations", icon: Building2, label: t("workspace.organizations") },
  ];

  const switchLocale = () => {
    const target = locale === "ar" ? "en" : "ar";
    const path = target === "ar" ? "/" : "/en";
    window.location.href = path + "my-projects";
  };

  const hrefFor = (route: string) => {
    const prefix = locale === "ar" ? "/" : "/en/";
    return prefix + route;
  };

  return (
    <div className={`mp-shell ${cairo.variable} ${ibmPlex.variable} ${sidebarOpen ? "menu-open" : ""}`}>
      <aside
        className="mp-sidebar"
        aria-label={t("nav.aria")}
      >
        <div className="mp-sidebar-mobile-brand">
          STR
          <button onClick={() => setSidebarOpen(false)} aria-label={t("closeMenu")}>
            <X />
          </button>
        </div>
        <nav>
          {navLinks.map((link, i) => (
            <Link
              key={i}
              className={`mp-nav-link ${i === 1 ? "active" : ""}`}
              href={hrefFor(link.href)}
              onClick={() => setSidebarOpen(false)}
            >
              <link.icon />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
        <div className="mp-sidebar-divider" />
        <small className="mp-sidebar-heading">{t("workspace.label")}</small>
        <nav>
          {workspaceLinks.map((ws, i) => (
            <Link
              key={i}
              className="mp-nav-link"
              href={hrefFor(ws.href)}
              onClick={() => setSidebarOpen(false)}
            >
              <ws.icon />
              <span>{ws.label}</span>
            </Link>
          ))}
        </nav>
        <div className="mp-sidebar-promo">
          <div className="mp-promo-sky">✦</div>
          <b>{t("promo.title")}</b>
          <button onClick={() => showToast(t("promo.joinToast"))}>
            {t("promo.join")}
          </button>
        </div>
      </aside>
      <div className="mp-mobile-scrim" onClick={() => setSidebarOpen(false)} />

      <div className="mp-main">
        <header className="mp-topbar">
          <button
            className="mp-icon-button mp-mobile-menu"
            aria-label={t("openMenu")}
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>
          <Link href={hrefFor("dashboard")} className="mp-brand">
            <span className="mp-brand-mark">
              ✦<b>STR</b>
            </span>
            <span className="mp-brand-text">
              <strong>Syrian Tech Renaissance</strong>
              <small>{t("brandSub")}</small>
            </span>
          </Link>
          <label className="mp-global-search">
            <Search />
            <input
              placeholder={t("globalSearch")}
              onKeyDown={(e) => {
                if (e.key === "Enter") showToast(t("demoSearch"));
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="mp-top-actions">
            <button
              className="mp-icon-button"
              aria-label={t("themeToggle")}
              onClick={() => showToast(t("darkModeIsReference"))}
            >
              <Sun />
              <Moon />
            </button>
            <button
              className="mp-locale-switch"
              aria-label={t("changeLanguage")}
              onClick={switchLocale}
            >
              <Globe />
              <span>{locale.toUpperCase()}</span>
              <ChevronDown />
            </button>
            <button
              className="mp-icon-button mp-notification"
              aria-label={t("notifications")}
              onClick={() => showToast(t("demoNotifications"))}
            >
              <Bell />
              <em>5</em>
            </button>
            <span className="mp-avatar">{t("avatarInitial")}</span>
            <span className="mp-user-name">
              <b>{t("welcome")}</b>
              <small>{t("user")}</small>
            </span>
          </div>
        </header>

        {children}
      </div>

      {toast && (
        <div className="mp-toast show" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
