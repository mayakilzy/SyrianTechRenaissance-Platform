"use client";

import { Cairo, IBM_Plex_Sans } from "next/font/google";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useCallback } from "react";
import {
  House, Folder, BriefcaseBusiness, Blocks, UsersRound, Network,
  GraduationCap, CalendarDays, MessageSquare, Settings,
  Search, Bell, Globe, ChevronDown, Menu, X, Sun, Moon,
  Briefcase as BriefcaseIcon, Users, Star, Building2, Plus,
} from "lucide-react";
import "./shell.css";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("dashboard");
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
    { href: "featured", icon: Blocks, label: t("nav.projects") },
    { href: "engineers", icon: UsersRound, label: t("nav.engineers") },
    { href: "featured", icon: Network, label: t("nav.community") },
    { href: "learning", icon: GraduationCap, label: t("nav.learning") },
    { href: "activity", icon: CalendarDays, label: t("nav.events") },
    { href: "activity", icon: MessageSquare, label: t("nav.messages") },
    { href: "settings", icon: Settings, label: t("nav.settings") },
  ];

  const workspaceLinks = [
    { href: "my-projects", icon: BriefcaseIcon, label: t("workspace.personalProjects"), color: "blue" },
    { href: "engineers", icon: Users, label: t("workspace.team"), color: "purple" },
    { href: "featured", icon: Star, label: t("workspace.favorites"), color: "green" },
    { href: "featured", icon: Building2, label: t("workspace.organizations"), color: "orange" },
  ];

  const switchLocale = () => {
    const target = locale === "ar" ? "en" : "ar";
    // next-intl with localePrefix "as-needed": / for ar, /en for en
    const path = target === "ar" ? "/" : "/en";
    window.location.href = path + "dashboard";
  };

  return (
    <div className={`str-shell ${cairo.variable} ${ibmPlex.variable}`}>
      <aside
        className={`str-sidebar ${sidebarOpen ? "open" : ""}`}
        id="sidebar"
        aria-label={t("nav.aria")}
      >
        <div className="str-sidebar-mobile-brand">
          STR
          <button className="str-icon-button" onClick={() => setSidebarOpen(false)} aria-label={t("closeMenu")}>
            <X />
          </button>
        </div>
        <nav className="str-nav-main">
          {navLinks.map((link, i) => (
            <Link
              key={i}
              className={`str-nav-link ${i === 0 ? "active" : ""}`}
              href={`/${locale === "ar" ? "" : "en/"}${link.href === "dashboard" ? "dashboard" : link.href}`}
              onClick={() => setSidebarOpen(false)}
            >
              <link.icon />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
        <div className="str-workspace">
          <p className="str-workspace-label">{t("workspace.label")}</p>
          {workspaceLinks.map((ws, i) => (
            <Link
              key={i}
              href={`/${locale === "ar" ? "" : "en/"}${ws.href}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className={`str-mini-icon ${ws.color}`}>
                <ws.icon />
              </span>
              <span>{ws.label}</span>
            </Link>
          ))}
        </div>
        <div className="str-sidebar-promo">
          {/* sidebar-heritage.webp — no flag on the castle (per approved reference) */}
          <img src="/dashboard/sidebar-heritage.webp" alt={t("heritage.alt")} />
          <div className="str-promo-copy">
            <strong>{t("heritage.title")}</strong>
            <Link href={`/${locale === "ar" ? "" : "en/"}featured`} onClick={() => setSidebarOpen(false)}>
              {t("heritage.cta")}
            </Link>
          </div>
        </div>
      </aside>

      <div className="str-main-wrap" id="dashboard">
        <header className="str-topbar">
          <div className="str-brand">
            <div className="str-brand-symbol">
              ✦<strong>STR</strong>
            </div>
            <div>
              <strong>Syrian Tech Renaissance</strong>
              <small>{t("brandAr")}</small>
            </div>
          </div>
          <label className="str-search">
            <Search />
            <input
              placeholder={t("search")}
              onKeyDown={(e) => {
                if (e.key === "Enter") showToast(t("demoSearch"));
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="str-header-actions">
            <button
              className="str-theme-switch"
              aria-label={t("themeToggle")}
              onClick={() => showToast(t("darkModeIsReference"))}
            >
              <Sun />
              <Moon />
            </button>
            <button
              className="str-language-switch"
              aria-label={t("changeLanguage")}
              onClick={switchLocale}
            >
              <Globe />
              <span>{locale.toUpperCase()}</span>
              <ChevronDown />
            </button>
            <button
              className="str-icon-button str-notification"
              aria-label={t("notifications")}
              onClick={() => showToast(t("demoNotifications"))}
            >
              <Bell />
              <b>5</b>
            </button>
            <div className="str-profile">
              <div className="str-avatar">{t("avatarInitial")}</div>
              <div className="str-profile-name">
                <strong>{t("welcomeSmall")}</strong>
                <small>{t("userName")}</small>
              </div>
            </div>
            <button
              className="str-icon-button str-mobile-menu"
              aria-label={t("openMenu")}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </button>
          </div>
        </header>

        <main className="str-content">
          {children}
        </main>
      </div>

      {toast && (
        <div className="str-toast show" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
