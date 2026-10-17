import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOpportunityById } from "@/modules/opportunities/service";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OpportunityDetailActions } from "./OpportunityDetailActions";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "opportunities" });
  const session = await getServerSession(getAuthOptions());

  const opp = await getOpportunityById(id);
  if (!opp) notFound();

  const isCreator = session?.user?.id === opp.createdById;
  const isAdmin = session?.user?.id ? !!(await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "admin", scope: "global", revokedAt: null } })) : false;
  const isReviewer = session?.user?.id ? !!(await db.roleGrant.findFirst({ where: { userId: session.user.id, role: "reviewer", scope: "global", revokedAt: null } })) : false;

  // Authorization: non-published visible only to creator, reviewers, admins.
  if (!isCreator && !isAdmin && !isReviewer && opp.status !== "PUBLISHED") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-3xl">
        <Link href="/opportunities" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">← {t("backToList")}</Link>
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{opp.title}</h1>
            <div className="flex gap-2">
              <Badge variant="outline">{opp.type}</Badge>
              <Badge variant={opp.status === "PUBLISHED" ? "default" : "secondary"}>{opp.status}</Badge>
            </div>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4">
            <div><h3 className="font-semibold mb-1">{t("description")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{opp.description}</p></div>
            {opp.requirements && <div><h3 className="font-semibold mb-1">{t("requirements")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{opp.requirements}</p></div>}
            {opp.location && <div><h3 className="font-semibold mb-1">{t("location")}</h3><p className="text-sm text-muted-foreground">{opp.location} {opp.isRemote ? "(Remote)" : ""}</p></div>}
            {opp.compensationType && <div><h3 className="font-semibold mb-1">{t("compensation")}</h3><p className="text-sm text-muted-foreground">{opp.compensationType}</p></div>}
          </CardContent>
        </Card>

        {opp.reviews.length > 0 && (isCreator || isAdmin || isReviewer) && (
          <Card className="mb-6">
            <CardHeader><CardTitle className="text-lg">{t("reviewHistory")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {opp.reviews.map(r => (
                <div key={r.id} className="border-l-2 border-border ps-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.action === "APPROVE" ? "default" : r.action === "REJECT" ? "destructive" : "secondary"}>{r.action}</Badge>
                    <span className="text-sm text-muted-foreground">{r.reviewer.displayName}</span>
                  </div>
                  <p className="text-sm mt-1">{r.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <OpportunityDetailActions
          opportunityId={opp.id}
          status={opp.status}
          isCreator={isCreator}
          canReview={isReviewer || isAdmin}
          canApply={!!session?.user?.id && !isCreator && opp.status === "PUBLISHED"}
        />
      </div>
    </div>
  );
}
