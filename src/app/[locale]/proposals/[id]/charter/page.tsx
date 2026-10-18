import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";
import { CharterEditor } from "./CharterEditor";

/**
 * STR Project Charter Editor (Structured Form + Live Preview)
 * Per-proposal charter revision with live preview.
 */
export default async function CharterPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  const proposal = await db.projectProposal.findUnique({
    where: { id },
    include: { currentRevision: true, submitter: { select: { id: true, displayName: true } } },
  });
  if (!proposal) notFound();
  if (proposal.submitterId !== session.user.id) {
    // Only the submitter can edit the charter
    notFound();
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" dir={locale === "ar" ? "rtl" : "ltr"}>
      <SiteHeader />
      <main className="flex-1 container mx-auto px-4 sm:px-6 py-8">
        <CharterEditor
          proposalId={proposal.id}
          initialRevision={proposal.currentRevision}
          locale={locale}
          status={proposal.status}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
