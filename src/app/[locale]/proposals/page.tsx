import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getProposalsForUser, getProposalsForReview } from "@/modules/proposals/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";

export default async function ProposalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "proposals" });
  const session = await getServerSession(getAuthOptions());

  if (!session?.user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md"><CardContent className="pt-6 text-center">
          <p className="mb-4">{t("signinRequired")}</p>
          <Button asChild><Link href="/auth/signin">{t("signin")}</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  const [myProposals, reviewQueue] = await Promise.all([
    getProposalsForUser(session.user.id),
    getProposalsForReview(session.user.id),
  ]);

  return (
    <div className="min-h-screen bg-background flex flex-col"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <SiteHeader />>
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <Button asChild><Link href="/proposals/new">{t("newProposal")}</Link></Button>
        </div>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">{t("myProposals")}</h2>
          {myProposals.length === 0 ? (
            <Card><CardContent className="pt-6 text-muted-foreground text-center">{t("noProposals")}</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {myProposals.map((p) => (
                <Card key={p.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">{p.title}</CardTitle>
                    <Badge variant={p.status === "APPROVED" ? "default" : p.status === "REJECTED" ? "destructive" : "secondary"}>{p.status}</Badge>
                  </CardHeader>
                  <CardContent>
                    <Link href={`/proposals/${p.id}`} className="text-sm text-primary hover:underline">{t("viewDetails")}</Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {reviewQueue.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-4">{t("reviewQueue")}</h2>
            <div className="space-y-3">
              {reviewQueue.map((p) => (
                <Card key={p.id}>
                  <CardHeader><CardTitle className="text-lg">{p.title}</CardTitle></CardHeader>
                  <CardContent>
                    <Link href={`/proposals/${p.id}`} className="text-sm text-primary hover:underline">{t("review")}</Link>
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
