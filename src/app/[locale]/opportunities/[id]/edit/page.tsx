"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

export default function EditOpportunityPage() {
  const t = useTranslations("opportunities");
  const router = useRouter();
  const params = useParams<{ id: string; locale: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", requirements: "", location: "", compensationType: "" });

  useEffect(() => {
    fetch(`/api/opportunities/${params.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          const o = data.data.opportunity;
          setForm({
            title: o.title || "", description: o.description || "",
            requirements: o.requirements || "", location: o.location || "",
            compensationType: o.compensationType || "",
          });
        }
        setLoading(false);
      })
      .catch(() => { setError("Failed to load"); setLoading(false); });
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${params.id}/edit`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "Failed"); return; }
      router.push(`/opportunities/${params.id}`);
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
        <h1 className="text-3xl font-bold mb-8">{t("editOpportunity")}</h1>
        <Card><CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="space-y-2"><Label htmlFor="title">{t("title")} *</Label><Input id="title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required minLength={5} /></div>
            <div className="space-y-2"><Label htmlFor="description">{t("description")} *</Label><Textarea id="description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required minLength={20} rows={5} /></div>
            <div className="space-y-2"><Label htmlFor="requirements">{t("requirements")}</Label><Textarea id="requirements" value={form.requirements} onChange={e => setForm({...form, requirements: e.target.value})} rows={3} /></div>
            <div className="space-y-2"><Label htmlFor="location">{t("location")}</Label><Input id="location" value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></div>
            <div className="space-y-2"><Label htmlFor="compensationType">{t("compensation")}</Label><Input id="compensationType" value={form.compensationType} onChange={e => setForm({...form, compensationType: e.target.value})} /></div>
            <Button type="submit" disabled={saving} className="w-full">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("saveDraft")}</Button>
          </form>
        </CardContent></Card>
      </div>
    </div>
  );
}
