"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function OpportunityDetailActions({
  opportunityId,
  status,
  isCreator,
  canReview,
  canApply,
}: {
  opportunityId: string;
  status: string;
  isCreator: boolean;
  canReview: boolean;
  canApply: boolean;
}) {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState<"approve" | "reject" | "revise" | null>(null);
  const [reason, setReason] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [showApplyForm, setShowApplyForm] = useState(false);

  async function doAction(action: string, body: Record<string, unknown> = {}) {
    setLoading(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
      else { const d = await res.json(); alert(d.error?.message ?? "Failed"); }
    } finally { setLoading(false); }
  }

  async function applyForOpp() {
    setLoading(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/applications`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverNote: coverNote || undefined }),
      });
      if (res.ok) {
        alert(t("appliedSuccess"));
        router.refresh();
      } else {
        const d = await res.json();
        alert(d.error?.message ?? "Failed");
      }
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{t("actions")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Creator actions */}
        {isCreator && (status === "DRAFT" || status === "NEEDS_REVISION") && (
          <Button onClick={() => doAction("submit")} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("submitForReview")}
          </Button>
        )}
        {isCreator && status === "PUBLISHED" && (
          <Button variant="outline" onClick={() => doAction("close")} disabled={loading}>{t("closeOpportunity")}</Button>
        )}

        {/* Apply button for regular members on PUBLISHED */}
        {canApply && !showApplyForm && (
          <Button onClick={() => setShowApplyForm(true)}>{t("apply")}</Button>
        )}
        {canApply && showApplyForm && (
          <div className="space-y-2">
            <Label>{t("coverNote")}</Label>
            <Textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={4}
              placeholder={t("coverNotePlaceholder")} />
            <div className="flex gap-2">
              <Button onClick={applyForOpp} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("confirmApply")}
              </Button>
              <Button variant="outline" onClick={() => setShowApplyForm(false)}>{t("cancel")}</Button>
            </div>
          </div>
        )}

        {/* Review actions for institutional reviewers */}
        {canReview && status === "SUBMITTED" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setReviewMode("approve")}>{t("approve")}</Button>
              <Button variant="destructive" size="sm" onClick={() => setReviewMode("reject")}>{t("reject")}</Button>
              <Button variant="outline" size="sm" onClick={() => setReviewMode("revise")}>{t("requestRevision")}</Button>
            </div>
            {reviewMode && (
              <div className="space-y-2">
                <Label>{t("reason")}</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} />
                <Button disabled={loading || reason.length < 10} onClick={() =>
                  doAction("review", {
                    action: reviewMode === "approve" ? "APPROVE" : reviewMode === "reject" ? "REJECT" : "REQUEST_REVISION",
                    reason
                  })
                }>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("confirm")}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
