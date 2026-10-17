import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listMilestones, createMilestone, loadProjectContext } from "@/modules/projects/service";
import { MilestonesClient } from "./MilestonesClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * STR G05 — Milestones Management Page
 * Lead/steward can create + transition milestones; team members can view.
 */
export default async function MilestonesPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`);
  }

  const ctx = await loadProjectContext(id, session.user.id);
  if (!ctx) notFound();
  if (!ctx.isLead && !ctx.isSteward && !ctx.isMember && !ctx.isAdmin) {
    notFound();
  }

  const milestones = await listMilestones(id, session.user.id);
  const canManage = ctx.isLead || ctx.isSteward || ctx.isAdmin;

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/projects/${id}/workspace`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← مساحة العمل" : "← Workspace"}
          </Link>
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "المراحل" : "Milestones"}
          </h1>
          <p className="text-muted-foreground">{ctx.project.title}</p>
        </header>

        <MilestonesClient
          projectId={id}
          milestones={milestones}
          canManage={canManage}
          locale={locale}
        />
      </div>
    </div>
  );
}
