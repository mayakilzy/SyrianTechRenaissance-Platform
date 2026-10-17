import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { searchTalent } from "@/modules/talent/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TalentSearchClient } from "./TalentSearchClient";

export default async function TalentPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "talent" });
  const session = await getServerSession(getAuthOptions());
  const sp = await searchParams;

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md"><CardContent className="pt-6 text-center">
          <p className="mb-4">{t("signinRequired")}</p>
          <Link href="/auth/signin" className="text-primary hover:underline">{t("signin")}</Link>
        </CardContent></Card>
      </div>
    );
  }

  const query = typeof sp.query === "string" ? sp.query : undefined;
  const skill = typeof sp.skill === "string" ? sp.skill : undefined;
  const page = parseInt(typeof sp.page === "string" ? sp.page : "1") || 1;

  const result = await searchTalent({ query, skill, page, pageSize: 20 });

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">{t("title")}</h1>
        <TalentSearchClient initialQuery={query ?? ""} initialSkill={skill ?? ""} />
        {result.results.length === 0 ? (
          <Card><CardContent className="pt-6 text-muted-foreground text-center">{t("noResults")}</CardContent></Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {result.results.map((p) => (
              <Card key={p.id}>
                <CardHeader><CardTitle className="text-lg">{p.displayName}</CardTitle></CardHeader>
                <CardContent>
                  {p.headline && <p className="text-sm text-muted-foreground mb-2">{p.headline}</p>}
                  {p.availability && <Badge variant="outline" className="mb-2">{p.availability}</Badge>}
                  {p.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.skills.slice(0, 5).map(s => <Badge key={s.name} variant="secondary">{s.name}</Badge>)}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">{result.total} {t("resultsCount")} · {t("page")} {result.page}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
