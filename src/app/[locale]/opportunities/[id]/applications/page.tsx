import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOpportunityById, getApplicationsForOpportunity } from "@/modules/opportunities/service";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ApplicationDecisionClient } from "./ApplicationDecisionClient";

export default async function OpportunityApplicationsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "opportunities" });
  const session = await getServerSession(getAuthOptions());

  const opp = await getOpportunityById(id);
  if (!opp) notFound();

  const isCreator = session?.user?.id === opp.createdById;
  const isAdmin = session?.user?.id ? !!(await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "admin", scope: "global", revokedAt: null } })) : false;
  const isReviewer = session?.user?.id ? !!(await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "reviewer", scope: "global", revokedAt: null } })) : false;

  if (!isCreator && !isAdmin && !isReviewer) notFound();

  const apps = await getApplicationsForOpportunity(id, session!.user!.id);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-4xl">
        <Link href={`/opportunities/${id}`} className="text-sm text-muted-foreground hover:underline mb-4 inline-block">← {t("backToOpportunity")}</Link>
        <h1 className="text-3xl font-bold mb-2">{opp.title}</h1>
        <h2 className="text-xl text-muted-foreground mb-8">{t("reviewApplications")} ({apps.length})</h2>
        {apps.length === 0 ? (
          <Card><CardContent className="pt-6 text-muted-foreground text-center">{t("noApplications")}</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {apps.map(app => (
              <Card key={app.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-lg">{app.applicant.displayName}</CardTitle>
                  <Badge variant={app.status === "ACCEPTED" ? "default" : app.status === "REJECTED" ? "destructive" : "secondary"}>{app.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {app.coverNote && <div><h3 className="font-semibold text-sm mb-1">{t("coverNote")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{app.coverNote}</p></div>}
                  {app.decisionReason && <div><h3 className="font-semibold text-sm mb-1">{t("decisionReason")}</h3><p className="text-sm text-muted-foreground">{app.decisionReason}</p></div>}
                  {/* qualificationNotes are PRIVATE — only shown to creator/reviewer, NOT to applicant */}
                  {(isCreator || isReviewer || isAdmin) && app.qualificationNotes && (
                    <div className="border-l-2 border-border ps-3"><h3 className="font-semibold text-sm mb-1">{t("qualificationNotes")}</h3><p className="text-sm text-muted-foreground">{app.qualificationNotes}</p></div>
                  )}
                  {(app.status === "SUBMITTED" || app.status === "UNDER_REVIEW") && (isCreator || isReviewer || isAdmin) && (
                    <ApplicationDecisionClient applicationId={app.id} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
