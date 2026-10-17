"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ApplicationsClient({ applicationId, status }: { applicationId: string; status: string }) {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const canWithdraw = status === "SUBMITTED" || status === "UNDER_REVIEW";

  async function withdraw() {
    setLoading(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/withdraw`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (res.ok) router.refresh();
      else { const d = await res.json(); alert(d.error?.message ?? "Failed"); }
    } finally { setLoading(false); }
  }

  if (!canWithdraw) return null;
  return (
    <Button variant="outline" size="sm" onClick={withdraw} disabled={loading}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("withdraw")}
    </Button>
  );
}
