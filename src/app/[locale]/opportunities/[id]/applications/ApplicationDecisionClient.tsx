"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export function ApplicationDecisionClient({ applicationId }: { applicationId: string }) {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED">("ACCEPTED");
  const [reason, setReason] = useState("");
  const [qualificationNotes, setQualificationNotes] = useState("");

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason, qualificationNotes: qualificationNotes || undefined }),
      });
      if (res.ok) router.refresh();
      else { const d = await res.json(); alert(d.error?.message ?? "Failed"); }
    } finally { setLoading(false); }
  }

  if (!showForm) {
    return (
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { setDecision("ACCEPTED"); setShowForm(true); }}>{t("accept")}</Button>
        <Button variant="destructive" size="sm" onClick={() => { setDecision("REJECTED"); setShowForm(true); }}>{t("decline")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border rounded-lg p-4">
      <div className="space-y-2">
        <Label>{t("decisionReason")}</Label>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} />
      </div>
      <div className="space-y-2">
        <Label>{t("qualificationNotes")}</Label>
        <Textarea value={qualificationNotes} onChange={e => setQualificationNotes(e.target.value)} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={loading || reason.length < 5} onClick={submit}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : decision === "ACCEPTED" ? t("accept") : t("decline")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
      </div>
    </div>
  );
}
