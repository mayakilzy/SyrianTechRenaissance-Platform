"use client";

import { Cairo, IBM_Plex_Sans } from "next/font/google";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useCallback } from "react";
import {
  House, Folder, BriefcaseBusiness, User, UsersRound,
  Network, CalendarDays, MessageSquare, Settings,
  Search, Bell, Globe, ChevronDown, Menu, X,
} from "lucide-react";
import "./profile.css";

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

export function ProfileShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("profile");
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
    { href: "opportunities", icon: BriefcaseBusiness, label: t("nav.opportunities") },
    { href: "profile", icon: User, label: t("nav.profile") },
    { href: "talent", icon: UsersRound, label: t("nav.talent") },
    { href: "organizations", icon: Network, label: t("nav.partnerships") },
    { href: "opportunities", icon: CalendarDays, label: t("nav.events") },
    { href: "integrations", icon: MessageSquare, label: t("nav.tools") },
    { href: "settings", icon: Settings, label: t("nav.settings") },
  ];

  const switchLocale = () => {
    const target = locale === "ar" ? "en" : "ar";
    const path = target === "ar" ? "/" : "/en";
    window.location.href = path + "profile";
  };

  const hrefFor = (route: string) => {
    const prefix = locale === "ar" ? "/" : "/en/";
    return prefix + route;
  };

  return (
    <div className={`str05-shell ${cairo.variable} ${ibmPlex.variable} ${sidebarOpen ? "menu-open" : ""}`}>
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label={t("openMenu")} onClick={() => setSidebarOpen(true)}>
          <Menu />
        </button>
        <Link href={hrefFor("dashboard")} className="brand">
          <span className="logo"><span className="star">✦</span>STR</span>
          <span className="brand-title"><strong>{t("brand")}</strong><small>{t("brandTag")}</small></span>
        </Link>
        <label className="global-search">
          <Search />
          <input placeholder={t("globalSearch")} onKeyDown={(e) => { if (e.key === "Enter") showToast(t("demoSearch")); }} aria-label="Global search" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="top-actions">
          <button className="icon-button" aria-label="Theme" onClick={() => showToast(t("darkModeIsReference"))}>
            <span>☀</span>
          </button>
          <button className="lang" aria-label={t("changeLanguage")} onClick={switchLocale}>
            ◎ <span>{locale.toUpperCase()}</span> ⌄
          </button>
          <button className="icon-button bell" aria-label={t("notifications")} onClick={() => showToast(t("demoNotifications"))}>
            ♧<i>5</i>
          </button>
          <span className="top-avatar">💻</span>
          <span className="account"><b>{t("welcome")}</b><small>{t("account")}</small></span>
        </div>
      </header>

      <aside className="sidebar">
        <nav>
          {navLinks.map((link, i) => (
            <Link key={i} className={`nav-link ${i === 3 ? "active" : ""}`} href={hrefFor(link.href)} onClick={() => setSidebarOpen(false)}>
              <link.icon className="nav-icon" />
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
        <div className="promo">
          <span>✦</span>
          <b>{t("promo")}</b>
          <small>{t("promoSub")}</small>
        </div>
      </aside>
      <button className="scrim" aria-label={t("closeMenu")} onClick={() => setSidebarOpen(false)} />

      <main className="main">
        {children}
      </main>

      {toast && (
        <div style={{ position: "fixed", bottom: "24px", left: "24px", background: "#0c3763", border: "1px solid #22a7ff", color: "white", borderRadius: "8px", padding: "12px 18px", zIndex: 50, boxShadow: "0 8px 30px rgba(0,0,0,0.55)" }} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
