/**
 * STR Platform — next-intl routing
 * Locale prefix: "as-needed" → default locale (ar) has no prefix, /en for English.
 */

import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  // URL determines the locale — do NOT redirect based on Accept-Language.
  // `/` always serves Arabic (default); `/en` always serves English.
  // This makes URLs stable and shareable regardless of the visitor's browser.
  localeDetection: false,
});
