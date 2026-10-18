import { Card, CardContent } from "@/components/ui/card";
import { useTranslations } from "next-intl";

/**
 * STR Platform — Loading/Empty/Error States (G08)
 * Reusable components for consistent UX states.
 */

export function LoadingState() {
  const t = useTranslations("ui");
  return (
    <Card>
      <CardContent className="pt-6 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" role="status" aria-label={t("loading")} />
        <p className="mt-2 text-sm text-muted-foreground">{t("loading")}</p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const t = useTranslations("ui");
  return (
    <Card>
      <CardContent className="pt-6 text-center text-muted-foreground">
        <p>{message || t("empty")}</p>
      </CardContent>
    </Card>
  );
}

export function ErrorState({ message }: { message?: string }) {
  const t = useTranslations("ui");
  return (
    <Card className="border-destructive">
      <CardContent className="pt-6 text-center text-destructive">
        <p>{message || t("error")}</p>
      </CardContent>
    </Card>
  );
}
