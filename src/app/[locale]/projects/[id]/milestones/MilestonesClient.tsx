"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Milestone {
  id: string;
  title: string;
  description: string;
  status: string;
  dueDate: Date | null;
  _count: { tasks: number };
}

interface Props {
  projectId: string;
  milestones: Milestone[];
  canManage: boolean;
  locale: string;
}

const ACTIONS: { action: string; labelAr: string; labelEn: string; from: string }[] = [
  { action: "start", labelAr: "ابدأ", labelEn: "Start", from: "PLANNED" },
  { action: "complete", labelAr: "أكمل", labelEn: "Complete", from: "IN_PROGRESS" },
  { action: "cancel", labelAr: "ألغِ", labelEn: "Cancel", from: "PLANNED" },
];

export function MilestonesClient({ projectId, milestones, canManage, locale }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error?.message || (locale === "ar" ? "فشل الإنشاء" : "Failed to create"));
        return;
      }
      setTitle("");
      setDescription("");
      setDueDate("");
      setShowForm(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(milestoneId: string, action: string) {
    const res = await fetch(`/api/projects/${projectId}/milestones/${milestoneId}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      alert(err?.error?.message || (locale === "ar" ? "فشل الإجراء" : "Action failed"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <Button onClick={() => setShowForm(!showForm)}>
          {locale === "ar" ? "إنشاء مرحلة جديدة" : "Create new milestone"}
        </Button>
      )}

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "مرحلة جديدة" : "New Milestone"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label htmlFor="title">{locale === "ar" ? "العنوان" : "Title"}</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
              </div>
              <div>
                <Label htmlFor="description">{locale === "ar" ? "الوصف" : "Description"}</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={10000} rows={4} />
              </div>
              <div>
                <Label htmlFor="dueDate">{locale === "ar" ? "تاريخ الاستحقاق (اختياري)" : "Due date (optional)"}</Label>
                <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? (locale === "ar" ? "...جارٍ" : "Submitting...") : (locale === "ar" ? "إنشاء" : "Create")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {milestones.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {locale === "ar" ? "لا توجد مراحل بعد." : "No milestones yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {milestones.map((m) => (
            <Card key={m.id}>
              <CardContent className="pt-6 flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{m.title}</h3>
                    <Badge variant={m.status === "COMPLETED" ? "default" : m.status === "IN_PROGRESS" ? "secondary" : "outline"}>
                      {m.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === "ar" ? "المهام:" : "Tasks:"} {m._count.tasks}
                    {m.dueDate && ` • ${locale === "ar" ? "الاستحقاق:" : "Due:"} ${new Date(m.dueDate).toLocaleDateString()}`}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-1 flex-wrap">
                    {ACTIONS.filter((a) => a.from === m.status).map((a) => (
                      <Button
                        key={a.action}
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(m.id, a.action)}
                      >
                        {locale === "ar" ? a.labelAr : a.labelEn}
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
