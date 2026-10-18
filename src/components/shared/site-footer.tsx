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
          {/* On mobile: stack Academy + Engineering vertically so each gets
              the full content width and text wraps cleanly. On desktop
              (sm+): horizontal row as before. */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground w-full sm:w-auto">
            <span className="flex items-start gap-1.5">
              <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-muted-foreground/30 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span>{t("academy")}</span>
                <span className="text-xs">{t("academyNote")}</span>
              </span>
            </span>
            <span className="flex items-start gap-1.5">
              <span className="inline-block w-2 h-2 mt-1.5 rounded-full bg-muted-foreground/30 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span>{t("engineering")}</span>
                <span className="text-xs">{t("engineeringNote")}</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
