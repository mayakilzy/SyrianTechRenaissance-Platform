import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getPublishedOpportunities, getMyOpportunities } from "@/modules/opportunities/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";

export default async function OpportunitiesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "opportunities" });
  const session = await getServerSession(getAuthOptions());
  const sp = await searchParams;
  const mine = sp.mine === "true";

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

  const myOpps = await getMyOpportunities(session.user.id);
  const published = mine ? null : await getPublishedOpportunities(1);

  return (
    <div className="min-h-screen bg-background flex flex-col"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <SiteHeader />>
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <Button asChild><Link href="/opportunities/new">{t("createOpportunity")}</Link></Button>
        </div>

        {myOpps.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">{t("myOpportunities")}</h2>
            <div className="space-y-3">
              {myOpps.map(o => (
                <Card key={o.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">{o.title}</CardTitle>
                    <div className="flex gap-2">
                      <Badge variant="outline">{o._count.applications} {t("applications")}</Badge>
                      <Badge variant={o.status === "PUBLISHED" ? "default" : "secondary"}>{o.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Link href={`/opportunities/${o.id}`} className="text-sm text-primary hover:underline">{t("viewDetails")}</Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {!mine && published && published.results.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-4">{t("publishedOpportunities")}</h2>
            <div className="space-y-3">
              {published.results.map(o => (
                <Card key={o.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">{o.title}</CardTitle>
                    <Badge variant="outline">{o.type}</Badge>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{o.description}</p>
                    <Link href={`/opportunities/${o.id}`} className="text-sm text-primary hover:underline mt-2 inline-block">{t("viewDetails")}</Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
