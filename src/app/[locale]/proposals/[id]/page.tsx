import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getProposalById } from "@/modules/proposals/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProposalActions } from "./ProposalActions";

export default async function ProposalDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "proposals" });
  const session = await getServerSession(getAuthOptions());

  const proposal = await getProposalById(id);
  if (!proposal) notFound();

  const isOwner = session?.user?.id === proposal.submitterId;
  const canReview = session?.user?.id && session.user.id !== proposal.submitterId && proposal.status === "SUBMITTED";

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-4xl">
        <Link href="/proposals" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">← {t("backToProposals")}</Link>
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{proposal.title}</h1>
            <Badge variant={proposal.status === "APPROVED" ? "default" : proposal.status === "REJECTED" ? "destructive" : "secondary"}>{proposal.status}</Badge>
          </div>
        </div>

        {proposal.currentRevision && (
          <Card className="mb-6">
            <CardHeader><CardTitle>{t("charter")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><h3 className="font-semibold mb-1">{t("problemStatement")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.currentRevision.problemStatement}</p></div>
              <div><h3 className="font-semibold mb-1">{t("outcomes")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.currentRevision.outcomes}</p></div>
              <div><h3 className="font-semibold mb-1">{t("scope")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.currentRevision.scope}</p></div>
              {proposal.currentRevision.requiredSkills.length > 0 && (
                <div><h3 className="font-semibold mb-1">{t("requiredSkills")}</h3><div className="flex flex-wrap gap-2">{proposal.currentRevision.requiredSkills.map(s => <Badge key={s} variant="outline">{s}</Badge>)}</div></div>
              )}
              <div><h3 className="font-semibold mb-1">{t("acceptanceCriteria")}</h3><p className="text-sm text-muted-foreground whitespace-pre-wrap">{proposal.currentRevision.acceptanceCriteria}</p></div>
            </CardContent>
          </Card>
        )}

        {proposal.reviewDecisions.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>{t("reviewHistory")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {proposal.reviewDecisions.map(d => (
                <div key={d.id} className="border-l-2 border-border ps-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={d.action === "APPROVE" ? "default" : d.action === "REJECT" ? "destructive" : "secondary"}>{d.action}</Badge>
                    <span className="text-sm text-muted-foreground">{d.reviewer.displayName}</span>
                  </div>
                  <p className="text-sm mt-1">{d.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {proposal.project && (
          <Card className="mb-6">
            <CardHeader><CardTitle>{t("projectCreated")}</CardTitle></CardHeader>
            <CardContent>
              <Link href={`/projects/${proposal.project.id}`} className="text-primary hover:underline">{t("viewProject")}</Link>
            </CardContent>
          </Card>
        )}

        {(isOwner || canReview) && (
          <ProposalActions proposalId={proposal.id} status={proposal.status} isOwner={isOwner} canReview={!!canReview} />
        )}
      </div>
    </div>
  );
}
