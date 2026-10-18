import { useTranslations } from "next-intl";

/**
 * STR Platform — Shared Footer (G08)
 * Includes STR brand + Academy/Engineering "coming soon" labels.
 */
export function SiteFooter() {
  const t = useTranslations("ui");
  const tf = useTranslations("footer");
  return (
    <footer className="border-t mt-auto" role="contentinfo">
      <div className="container mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            {tf("copyright") || "© 2026 Syrian Tech Renaissance"}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              {t("academy")} — <span className="text-xs">{t("academyNote")}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              {t("engineering")} — <span className="text-xs">{t("engineeringNote")}</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
