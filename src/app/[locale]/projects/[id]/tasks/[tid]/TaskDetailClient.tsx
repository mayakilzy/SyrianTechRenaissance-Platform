"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DeliverableInfo {
  id: string;
  status: string;
  currentVersion: number;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  assigneeId: string;
  assignee: { id: string; displayName: string | null; email: string };
  assignedBy: { id: string; displayName: string | null; email: string };
  milestone: { id: string; title: string; status: string } | null;
  deliverables: DeliverableInfo[];
}

interface Props {
  task: Task;
  projectId: string;
  locale: string;
  currentUserId: string;
}

export function TaskDetailClient({ task, projectId, locale, currentUserId }: Props) {
  const router = useRouter();
  const isAssignee = task.assigneeId === currentUserId;
  const deliverable = task.deliverables[0];
  const [textContent, setTextContent] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAccept() {
    const res = await fetch(`/api/projects/${projectId}/tasks/${task.id}/accept`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(err?.error?.message || (locale === "ar" ? "فشل القبول" : "Accept failed"));
      return;
    }
    router.refresh();
  }

  async function handleCreateDeliverable() {
    const res = await fetch(`/api/projects/${projectId}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(err?.error?.message || (locale === "ar" ? "فشل الإنشاء" : "Create failed"));
      return;
    }
    router.refresh();
  }

  async function handleSubmitVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!deliverable) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/deliverables/${deliverable.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textContent, notes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error?.message || (locale === "ar" ? "فشل التقديم" : "Submit failed"));
        return;
      }
      setTextContent("");
      setNotes("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{locale === "ar" ? "تفاصيل المهمة" : "Task Details"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{task.status}</Badge>
            {task.milestone && (
              <span className="text-sm text-muted-foreground">
                {locale === "ar" ? "المرحلة:" : "Milestone:"} {task.milestone.title}
              </span>
            )}
          </div>
          <p className="text-sm">
            {locale === "ar" ? "المُكلَّف:" : "Assignee:"} {task.assignee.displayName || task.assignee.email}
          </p>
          <p className="text-sm">
            {locale === "ar" ? "عَيَّنَ:" : "Assigned by:"} {task.assignedBy.displayName || task.assignedBy.email}
          </p>
        </CardContent>
      </Card>

      {isAssignee && task.status === "ASSIGNED" && (
        <Button onClick={handleAccept}>
          {locale === "ar" ? "قبول المهمة" : "Accept task"}
        </Button>
      )}

      {isAssignee && !deliverable && (task.status === "IN_PROGRESS" || task.status === "CHANGES_REQUESTED") && (
        <Button onClick={handleCreateDeliverable}>
          {locale === "ar" ? "إنشاء مخرج" : "Create deliverable"}
        </Button>
      )}

      {isAssignee && deliverable && (
        <Card>
          <CardHeader>
            <CardTitle>
              {locale === "ar" ? "تقديم نسخة جديدة" : "Submit new version"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {locale === "ar" ? "النسخة الحالية:" : "Current version:"} {deliverable.currentVersion} • {locale === "ar" ? "الحالة:" : "Status:"} {deliverable.status}
            </p>
            <form onSubmit={handleSubmitVersion} className="space-y-4">
              <div>
                <Label htmlFor="textContent">
                  {locale === "ar" ? "المحتوى النصي" : "Text content"}
                </Label>
                <Textarea
                  id="textContent"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  rows={6}
                  maxLength={50000}
                  placeholder={locale === "ar" ? "اكتب المخرج هنا..." : "Write deliverable content here..."}
                  required
                />
              </div>
              <div>
                <Label htmlFor="notes">
                  {locale === "ar" ? "ملاحظات" : "Notes"}
                </Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={10000}
                  required
                />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? (locale === "ar" ? "...جارٍ" : "Submitting...")
                  : (locale === "ar" ? "تقديم النسخة" : "Submit version")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {deliverable && (
        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "المخرج الحالي" : "Current deliverable"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {locale === "ar" ? "النسخة الحالية:" : "Current version:"} {deliverable.currentVersion}
            </p>
            <p className="text-sm mb-4">
              {locale === "ar" ? "الحالة:" : "Status:"} <Badge variant="outline">{deliverable.status}</Badge>
            </p>
            <Link
              href={`/${locale}/projects/${projectId}/deliverables/${deliverable.id}`}
              className="text-primary hover:underline text-sm"
            >
              {locale === "ar" ? "عرض تفاصيل المخرج ←" : "View deliverable details ←"}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
