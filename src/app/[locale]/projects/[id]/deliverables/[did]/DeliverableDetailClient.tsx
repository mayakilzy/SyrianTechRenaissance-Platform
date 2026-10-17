"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Version {
  id: string;
  versionNumber: number;
  textContent: string | null;
  notes: string;
  submittedAt: string | Date;
  fileEvidence: { id: string; fileName: string; scanStatus: string; mimeType: string; sizeBytes: number } | null;
}

interface Review {
  id: string;
  action: string;
  reason: string;
  attributionText: string | null;
  decidedAt: string | Date;
  reviewer: { id: string; displayName: string | null; email: string };
}

interface Contribution {
  id: string;
  attributionText: string;
  acceptedAt: string | Date;
}

interface Deliverable {
  id: string;
  status: string;
  currentVersion: number;
  task: { id: string; title: string; projectId: string; assigneeId: string };
  submitter: { id: string; displayName: string | null; email: string };
  versions: Version[];
  reviews: Review[];
  contribution: Contribution | null;
}

interface Props {
  deliverable: Deliverable;
  projectId: string;
  locale: string;
  currentUserId: string;
}

export function DeliverableDetailClient({ deliverable, projectId, locale, currentUserId }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<"ACCEPT" | "REJECT" | "REQUEST_CHANGES">("REQUEST_CHANGES");
  const [reason, setReason] = useState("");
  const [attributionText, setAttributionText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Determine the actor's role — for the client, we infer from whether they can review
  const isAssignee = deliverable.task.assigneeId === currentUserId;
  // The review action requires lead/steward — we don't expose role here, the API enforces it.
  // For UX, we show the review form only when the user is NOT the assignee.
  const canReview = !isAssignee && deliverable.status === "SUBMITTED";

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deliverables/${deliverable.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason,
          ...(action === "ACCEPT" && attributionText ? { attributionText } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error?.message || (locale === "ar" ? "فشلت المراجعة" : "Review failed"));
        return;
      }
      setReason("");
      setAttributionText("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (!confirm(locale === "ar" ? "تأكيد الانسحاب؟" : "Confirm withdraw?")) return;
    const res = await fetch(`/api/projects/${projectId}/deliverables/${deliverable.id}/withdraw`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(err?.error?.message || (locale === "ar" ? "فشل الانسحاب" : "Withdraw failed"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{locale === "ar" ? "حالة المخرج" : "Deliverable status"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            {locale === "ar" ? "المهمة:" : "Task:"} {deliverable.task.title}
          </p>
          <p className="text-sm">
            {locale === "ar" ? "المُسلِّم:" : "Submitter:"} {deliverable.submitter.displayName || deliverable.submitter.email}
          </p>
          <p className="text-sm">
            {locale === "ar" ? "النسخة الحالية:" : "Current version:"} {deliverable.currentVersion}
            <span className="mx-2">•</span>
            <Badge variant="outline">{deliverable.status}</Badge>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{locale === "ar" ? "سجل النسخ" : "Version history"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deliverable.versions.length === 0 ? (
            <p className="text-muted-foreground">
              {locale === "ar" ? "لا توجد نسخ بعد." : "No versions yet."}
            </p>
          ) : (
            deliverable.versions.map((v) => (
              <div key={v.id} className="border rounded p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">v{v.versionNumber}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(v.submittedAt).toLocaleString()}
                  </span>
                  {v.fileEvidence && (
                    <Badge variant="outline">{v.fileEvidence.scanStatus}</Badge>
                  )}
                </div>
                {v.textContent && (
                  <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-2 rounded">{v.textContent}</pre>
                )}
                <p className="text-xs text-muted-foreground">{v.notes}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canReview && (
        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "مراجعة المخرج" : "Review deliverable"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReview} className="space-y-4">
              <div>
                <Label>{locale === "ar" ? "الإجراء" : "Action"}</Label>
                <select
                  className="w-full p-2 border rounded"
                  value={action}
                  onChange={(e) => setAction(e.target.value as typeof action)}
                >
                  <option value="REQUEST_CHANGES">{locale === "ar" ? "طلب تعديلات" : "Request changes"}</option>
                  <option value="ACCEPT">{locale === "ar" ? "قبول" : "Accept"}</option>
                  <option value="REJECT">{locale === "ar" ? "رفض" : "Reject"}</option>
                </select>
              </div>
              <div>
                <Label htmlFor="reason">
                  {locale === "ar" ? "السبب" : "Reason"}
                </Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  required
                />
              </div>
              {action === "ACCEPT" && (
                <div>
                  <Label htmlFor="attributionText">
                    {locale === "ar" ? "نص الإسناد (اختياري — يُولَّد تلقائياً إن تُرك فارغاً)" : "Attribution text (optional — auto-generated if empty)"}
                  </Label>
                  <Textarea
                    id="attributionText"
                    value={attributionText}
                    onChange={(e) => setAttributionText(e.target.value)}
                    rows={2}
                    maxLength={2000}
                  />
                </div>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? (locale === "ar" ? "...جارٍ" : "Submitting...")
                  : (locale === "ar" ? "تنفيذ المراجعة" : "Submit review")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {deliverable.contribution && (
        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "الإسناد المسجَّل" : "Recorded attribution"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deliverable.contribution.attributionText}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {locale === "ar" ? "تاريخ القبول:" : "Accepted at:"} {new Date(deliverable.contribution.acceptedAt).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      )}

      {isAssignee && ["DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(deliverable.status) && (
        <Button variant="outline" onClick={handleWithdraw}>
          {locale === "ar" ? "انسحب من المخرج" : "Withdraw deliverable"}
        </Button>
      )}
    </div>
  );
}
