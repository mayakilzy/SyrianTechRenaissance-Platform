/**
 * STR Platform — next-intl request config
 * Loaded by the next-intl plugin (see next.config.ts) on every request.
 * Returns the message catalog for the active locale.
 */

import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import type { Locale } from "./config";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale =
    requested && (routing.locales as readonly string[]).includes(requested)
      ? (requested as Locale)
      : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
