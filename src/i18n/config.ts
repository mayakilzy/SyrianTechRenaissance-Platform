/**
 * STR Platform — i18n Configuration
 * Arabic-first (default, RTL), English (LTR). See UX-01 and 05-UX-Acceptance.
 */

export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

export const localeLabels: Record<Locale, { native: string; english: string; dir: "rtl" | "ltr" }> = {
  ar: { native: "العربية", english: "Arabic", dir: "rtl" },
  en: { native: "English", english: "English", dir: "ltr" },
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return localeLabels[locale].dir;
}
