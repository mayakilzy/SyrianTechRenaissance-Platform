"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    // Structured logging happens server-side; this is a client-side fallback
    // so the user sees a controlled state instead of a raw crash.
     
    console.error("[STR] route error:", error.message, error.digest);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-destructive mb-4">!</p>
        <h1 className="text-2xl font-semibold mb-2">{t("errorTitle")}</h1>
        <p className="text-muted-foreground mb-8">{t("errorDesc")}</p>
        <Button onClick={reset}>{t("errorCta")}</Button>
      </div>
    </div>
  );
}
