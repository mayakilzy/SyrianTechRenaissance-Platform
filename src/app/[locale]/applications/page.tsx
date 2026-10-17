import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getMyApplications } from "@/modules/opportunities/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApplicationsClient } from "./ApplicationsClient";

export default async function ApplicationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "opportunities" });
  const session = await getServerSession(getAuthOptions());

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

  const apps = await getMyApplications(session.user.id);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-bold mb-8">{t("myApplications")}</h1>
        {apps.length === 0 ? (
          <Card><CardContent className="pt-6 text-muted-foreground text-center">{t("noApplications")}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {apps.map(app => (
              <Card key={app.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">
                    <Link href={`/opportunities/${app.opportunity.id}`} className="hover:underline">{app.opportunity.title}</Link>
                  </CardTitle>
                  <Badge variant={app.status === "ACCEPTED" ? "default" : app.status === "REJECTED" ? "destructive" : "secondary"}>{app.status}</Badge>
                </CardHeader>
                <CardContent>
                  {app.decisionReason && <p className="text-sm text-muted-foreground mb-2">{app.decisionReason}</p>}
                  <ApplicationsClient applicationId={app.id} status={app.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
