"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

export default function NewProposalPage() {
  const t = useTranslations("proposals");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const title = form.get("title") as string;
    const skills = (form.get("requiredSkills") as string).split(",").map(s => s.trim()).filter(Boolean);

    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          charter: {
            problemStatement: form.get("problemStatement"),
            outcomes: form.get("outcomes"),
            scope: form.get("scope"),
            exclusions: form.get("exclusions") || undefined,
            beneficiaries: form.get("beneficiaries") || undefined,
            preliminaryArchitecture: form.get("preliminaryArchitecture") || undefined,
            requiredSkills: skills,
            resources: form.get("resources") || undefined,
            risks: form.get("risks") || undefined,
            rights: form.get("rights") || undefined,
            acceptanceCriteria: form.get("acceptanceCriteria"),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed"); return; }
      router.push("/proposals");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-8">{t("newProposal")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("charterDetails")}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <div className="space-y-2"><Label htmlFor="title">{t("title")}</Label><Input id="title" name="title" required minLength={5} /></div>
              <div className="space-y-2"><Label htmlFor="problemStatement">{t("problemStatement")} *</Label><Textarea id="problemStatement" name="problemStatement" required minLength={20} rows={4} /></div>
              <div className="space-y-2"><Label htmlFor="outcomes">{t("outcomes")} *</Label><Textarea id="outcomes" name="outcomes" required minLength={20} rows={4} /></div>
              <div className="space-y-2"><Label htmlFor="scope">{t("scope")} *</Label><Textarea id="scope" name="scope" required minLength={10} rows={3} /></div>
              <div className="space-y-2"><Label htmlFor="exclusions">{t("exclusions")}</Label><Textarea id="exclusions" name="exclusions" rows={2} /></div>
              <div className="space-y-2"><Label htmlFor="beneficiaries">{t("beneficiaries")}</Label><Textarea id="beneficiaries" name="beneficiaries" rows={2} /></div>
              <div className="space-y-2"><Label htmlFor="preliminaryArchitecture">{t("architecture")}</Label><Textarea id="preliminaryArchitecture" name="preliminaryArchitecture" rows={3} /></div>
              <div className="space-y-2"><Label htmlFor="requiredSkills">{t("requiredSkills")} * (comma-separated)</Label><Input id="requiredSkills" name="requiredSkills" required placeholder="TypeScript, PostgreSQL, React" /></div>
              <div className="space-y-2"><Label htmlFor="resources">{t("resources")}</Label><Textarea id="resources" name="resources" rows={2} /></div>
              <div className="space-y-2"><Label htmlFor="risks">{t("risks")}</Label><Textarea id="risks" name="risks" rows={2} /></div>
              <div className="space-y-2"><Label htmlFor="rights">{t("rights")}</Label><Textarea id="rights" name="rights" rows={2} /></div>
              <div className="space-y-2"><Label htmlFor="acceptanceCriteria">{t("acceptanceCriteria")} *</Label><Textarea id="acceptanceCriteria" name="acceptanceCriteria" required minLength={20} rows={3} /></div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("saveDraft")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
