"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface CharterRevision {
  problemStatement: string;
  outcomes: string;
  scope: string;
  exclusions: string | null;
  beneficiaries: string | null;
  preliminaryArchitecture: string | null;
  requiredSkills: string[];
  resources: string | null;
  risks: string | null;
  rights: string | null;
  acceptanceCriteria: string;
}

interface Props {
  proposalId: string;
  initialRevision: CharterRevision | null;
  locale: string;
  status: string;
}

const FIELDS: { key: keyof CharterRevision; labelAr: string; labelEn: string; type: "text" | "textarea"; required: boolean; minLen: number; maxLen: number }[] = [
  { key: "problemStatement", labelAr: "بيان المشكلة", labelEn: "Problem Statement", type: "textarea", required: true, minLen: 20, maxLen: 10000 },
  { key: "outcomes", labelAr: "النتائج المتوقعة", labelEn: "Expected Outcomes", type: "textarea", required: true, minLen: 20, maxLen: 10000 },
  { key: "scope", labelAr: "النطاق", labelEn: "Scope", type: "textarea", required: true, minLen: 10, maxLen: 10000 },
  { key: "exclusions", labelAr: "الاستثناءات", labelEn: "Exclusions", type: "textarea", required: false, minLen: 0, maxLen: 5000 },
  { key: "beneficiaries", labelAr: "المستفيدون", labelEn: "Beneficiaries", type: "textarea", required: false, minLen: 0, maxLen: 5000 },
  { key: "acceptanceCriteria", labelAr: "معايير القبول", labelEn: "Acceptance Criteria", type: "textarea", required: true, minLen: 20, maxLen: 10000 },
];

export function CharterEditor({ proposalId, initialRevision, locale, status }: Props) {
  const router = useRouter();
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [skillsInput, setSkillsInput] = useState(initialRevision?.requiredSkills.join(", ") || "");

  const [data, setData] = useState<CharterRevision>({
    problemStatement: initialRevision?.problemStatement || "",
    outcomes: initialRevision?.outcomes || "",
    scope: initialRevision?.scope || "",
    exclusions: initialRevision?.exclusions || "",
    beneficiaries: initialRevision?.beneficiaries || "",
    preliminaryArchitecture: initialRevision?.preliminaryArchitecture || "",
    requiredSkills: initialRevision?.requiredSkills || [],
    resources: initialRevision?.resources || "",
    risks: initialRevision?.risks || "",
    rights: initialRevision?.rights || "",
    acceptanceCriteria: initialRevision?.acceptanceCriteria || "",
  });

  const canEdit = status === "DRAFT" || status === "NEEDS_REVISION";

  async function handleSave() {
    setSaving(true);
    try {
      const skills = skillsInput.split(",").map(s => s.trim()).filter(Boolean);
      const res = await fetch(`/api/proposals/${proposalId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, requiredSkills: skills }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error?.message || (locale === "ar" ? "فشل الحفظ" : "Save failed"));
      }
    } finally {
      setSaving(false);
    }
  }

  const isAr = locale === "ar";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold">
            {isAr ? "محرر ميثاق المشروع" : "Project Charter Editor"}
          </h1>
          <Badge variant={status === "DRAFT" ? "outline" : "secondary"}>{status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {isAr ? "نموذج منظم مع معاينة حية — استخدم خدمات G03 للحفظ" : "Structured form with live preview — uses G03 services"}
        </p>
      </header>

      {/* Toggle between edit and preview */}
      <div className="flex gap-2" role="tablist">
        <Button
          variant={!showPreview ? "default" : "outline"}
          onClick={() => setShowPreview(false)}
          role="tab"
          aria-selected={!showPreview}
        >
          {isAr ? "تحرير" : "Edit"}
        </Button>
        <Button
          variant={showPreview ? "default" : "outline"}
          onClick={() => setShowPreview(true)}
          role="tab"
          aria-selected={showPreview}
        >
          {isAr ? "معاينة حية" : "Live Preview"}
        </Button>
      </div>

      {!showPreview ? (
        /* EDIT MODE: structured form */
        <div className="space-y-4">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <Label htmlFor={field.key} className="mb-1 block">
                {isAr ? field.labelAr : field.labelEn}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={field.key}
                  value={data[field.key] || ""}
                  onChange={(e) => setData({ ...data, [field.key]: e.target.value })}
                  disabled={!canEdit || saving}
                  maxLength={field.maxLen}
                  rows={4}
                  className="w-full"
                  aria-required={field.required}
                />
              ) : (
                <Input
                  id={field.key}
                  value={data[field.key] || ""}
                  onChange={(e) => setData({ ...data, [field.key]: e.target.value })}
                  disabled={!canEdit || saving}
                  maxLength={field.maxLen}
                  className="w-full"
                  aria-required={field.required}
                />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {(data[field.key] || "").length}/{field.maxLen}
              </p>
            </div>
          ))}

          {/* Skills (comma-separated) */}
          <div>
            <Label htmlFor="skills" className="mb-1 block">
              {isAr ? "المهارات المطلوبة (مفصولة بفواصل)" : "Required Skills (comma-separated)"}
              <span className="text-destructive ml-1">*</span>
            </Label>
            <Input
              id="skills"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              disabled={!canEdit || saving}
              className="w-full"
              placeholder={isAr ? "React, Node.js, PostgreSQL" : "React, Node.js, PostgreSQL"}
              aria-required={true}
            />
          </div>

          {canEdit && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (isAr ? "...جارٍ" : "Saving...") : (isAr ? "حفظ الميثاق" : "Save Charter")}
            </Button>
          )}
          {!canEdit && (
            <p className="text-sm text-muted-foreground">
              {isAr ? "لا يمكن تعديل الميثاق في الحالة الحالية" : "Charter cannot be edited in the current status"}
            </p>
          )}
        </div>
      ) : (
        /* LIVE PREVIEW: render the charter as it will appear */
        <div className="space-y-4">
          {FIELDS.map((field) => {
            const value = data[field.key];
            if (!value) return null;
            return (
              <Card key={field.key}>
                <CardHeader>
                  <CardTitle className="text-sm">{isAr ? field.labelAr : field.labelEn}</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">{value}</pre>
                </CardContent>
              </Card>
            );
          })}
          {skillsInput && (
            <Card>
              <CardHeader><CardTitle className="text-sm">{isAr ? "المهارات المطلوبة" : "Required Skills"}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {skillsInput.split(",").map((s, i) => (
                    <Badge key={i} variant="secondary">{s.trim()}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {!data.problemStatement && !data.outcomes && (
            <Card><CardContent className="pt-6 text-center text-muted-foreground">
              {isAr ? "ابدأ بالكتابة لرؤية المعاينة" : "Start writing to see the preview"}
            </CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}
