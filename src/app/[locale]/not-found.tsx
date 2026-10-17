import Link from "next/link";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { defaultLocale, type Locale, isLocale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

/**
 * Locale-scoped 404. Next.js may render this without `params` when a path
 * doesn't match the [locale] segment, so we fall back to the default locale
 * rather than crashing.
 */
export default async function NotFound({
  params,
}: {
  params?: Promise<{ locale?: string }>;
}) {
  const resolved = params ? await params : undefined;
  const locale: Locale =
    resolved?.locale && isLocale(resolved.locale) ? resolved.locale : defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "errors" });

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-primary mb-4">
          {locale === "ar" ? "٤٠٤" : "404"}
        </p>
        <h1 className="text-2xl font-semibold mb-2">{t("notFoundTitle")}</h1>
        <p className="text-muted-foreground mb-8">{t("notFoundDesc")}</p>
        <Button asChild>
          <Link href="/">{t("notFoundCta")}</Link>
        </Button>
      </div>
    </div>
  );
}
