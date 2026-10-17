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

export default function NewOpportunityPage() {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          type: form.get("type") || "PROJECT",
          requirements: form.get("requirements") || undefined,
          location: form.get("location") || undefined,
          isRemote: form.get("isRemote") === "on",
          compensationType: form.get("compensationType") || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed"); return; }
      router.push("/opportunities");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
        <h1 className="text-3xl font-bold mb-8">{t("createOpportunity")}</h1>
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <div className="space-y-2"><Label htmlFor="title">{t("title")} *</Label><Input id="title" name="title" required minLength={5} /></div>
              <div className="space-y-2"><Label htmlFor="description">{t("description")} *</Label><Textarea id="description" name="description" required minLength={20} rows={5} /></div>
              <div className="space-y-2"><Label htmlFor="type">{t("type")}</Label>
                <select id="type" name="type" className="w-full border rounded-md p-2">
                  <option value="PROJECT">{t("typeProject")}</option>
                  <option value="TASK">{t("typeTask")}</option>
                  <option value="MENTORSHIP">{t("typeMentorship")}</option>
                  <option value="INTERNSHIP">{t("typeInternship")}</option>
                  <option value="CONSULTING">{t("typeConsulting")}</option>
                  <option value="OTHER">{t("typeOther")}</option>
                </select>
              </div>
              <div className="space-y-2"><Label htmlFor="requirements">{t("requirements")}</Label><Textarea id="requirements" name="requirements" rows={3} /></div>
              <div className="space-y-2"><Label htmlFor="location">{t("location")}</Label><Input id="location" name="location" /></div>
              <div className="space-y-2"><Label htmlFor="compensationType">{t("compensation")}</Label><Input id="compensationType" name="compensationType" placeholder="volunteer / paid / stipend" /></div>
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
