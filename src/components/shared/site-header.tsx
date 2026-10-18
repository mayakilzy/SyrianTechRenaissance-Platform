"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * STR Platform — Shared Site Header (G08)
 * Responsive navigation with RTL/LTR support, keyboard accessible.
 * Includes locale switcher (ar/en) and main navigation links.
 */
export function SiteHeader() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: `/${locale}/proposals`, label: t("proposals") },
    { href: `/${locale}/talent`, label: t("talent") },
    { href: `/${locale}/opportunities`, label: t("opportunities") },
    { href: `/${locale}/organizations`, label: t("organizations") },
    { href: `/${locale}/integrations`, label: t("integrations") },
    { href: `/${locale}/admin`, label: t("admin") },
  ];

  return (
    <header
      className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur overflow-x-hidden"
      role="banner"
    >
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2 font-bold"
            aria-label={locale === "ar" ? "الصفحة الرئيسية" : "Home page"}
          >
            <span className="text-lg" style={{ color: "#0f4c4a" }}>
              {locale === "ar" ? "النهضة التقنية السورية" : "Syrian Tech Renaissance"}
            </span>
          </Link>

          {/* Desktop navigation */}
          <nav
            className="hidden md:flex items-center gap-1"
            role="navigation"
            aria-label={t("language")}
          >
            {navLinks.map((link) => {
              const isActive = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-2 text-sm rounded-md transition-colors hover:bg-muted ${
                    isActive ? "bg-muted font-medium" : "text-muted-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side: locale switcher + mobile menu button */}
          <div className="flex items-center gap-2">
            {/* Locale switcher */}
            <div className="flex items-center gap-1" role="group" aria-label={t("language")}>
              <Link
                href={pathname?.replace(/^\/(en|ar)/, "/ar") || "/ar"}
                className={`px-2 py-1 text-xs rounded ${locale === "ar" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                aria-current={locale === "ar" ? "page" : undefined}
              >
                ع
              </Link>
              <Link
                href={pathname?.replace(/^\/(en|ar)/, "/en") || "/en"}
                className={`px-2 py-1 text-xs rounded ${locale === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                aria-current={locale === "en" ? "page" : undefined}
              >
                EN
              </Link>
            </div>

            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label={locale === "ar" ? "القائمة" : "Menu"}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Mobile navigation (collapsible) */}
        {mobileMenuOpen && (
          <nav
            className="md:hidden pb-3"
            role="navigation"
            aria-label={locale === "ar" ? "التنقل على الجوال" : "Mobile navigation"}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 text-sm rounded-md hover:bg-muted"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
