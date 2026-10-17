"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function ProposalActions({ proposalId, status, isOwner, canReview }: { proposalId: string; status: string; isOwner: boolean; canReview: boolean }) {
  const t = useTranslations("proposals");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState<"approve" | "reject" | "revise" | null>(null);
  const [reason, setReason] = useState("");
  const [stewardId, setStewardId] = useState("");

  async function doAction(action: string, body: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
      else { const d = await res.json(); alert(d.error?.message ?? "Failed"); }
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("actions")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {isOwner && (status === "DRAFT" || status === "NEEDS_REVISION") && (
          <Button onClick={() => doAction("submit", {})} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("submitForReview")}
          </Button>
        )}
        {isOwner && status !== "APPROVED" && status !== "REJECTED" && (
          <Button variant="outline" onClick={() => doAction("withdraw", {})} disabled={loading}>
            {t("withdraw")}
          </Button>
        )}
        {canReview && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button variant="default" size="sm" onClick={() => setReviewMode("approve")}>{t("approve")}</Button>
              <Button variant="destructive" size="sm" onClick={() => setReviewMode("reject")}>{t("reject")}</Button>
              <Button variant="outline" size="sm" onClick={() => setReviewMode("revise")}>{t("requestRevision")}</Button>
            </div>
            {reviewMode && (
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="space-y-2">
                  <Label>{t("reason")} *</Label>
                  <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} minLength={10} />
                </div>
                {reviewMode === "approve" && (
                  <div className="space-y-2">
                    <Label>{t("stewardId")} * (user ID of the institutional steward)</Label>
                    <Input value={stewardId} onChange={e => setStewardId(e.target.value)} />
                  </div>
                )}
                <Button
                  disabled={loading || reason.length < 10 || (reviewMode === "approve" && !stewardId)}
                  onClick={() => doAction("review", { action: reviewMode === "approve" ? "APPROVE" : reviewMode === "reject" ? "REJECT" : "REQUEST_REVISION", reason, stewardId: stewardId || undefined })}
                >
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
