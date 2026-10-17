"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

export function TalentSearchClient({ initialQuery, initialSkill }: { initialQuery: string; initialSkill: string }) {
  const router = useRouter();
  const t = useTranslations("talent");
  const [query, setQuery] = useState(initialQuery);
  const [skill, setSkill] = useState(initialSkill);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (skill) params.set("skill", skill);
    router.push(`/talent?${params.toString()}`);
  }

  return (
    <form onSubmit={search} className="flex gap-2 mb-4">
      <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} className="flex-1" />
      <Input value={skill} onChange={e => setSkill(e.target.value)} placeholder={t("skillPlaceholder")} className="w-48" />
      <Button type="submit"><Search className="w-4 h-4" /></Button>
    </form>
  );
}
