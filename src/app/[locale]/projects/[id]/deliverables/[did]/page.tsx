import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getDeliverable } from "@/modules/projects/deliverables";
import { DeliverableDetailClient } from "./DeliverableDetailClient";

/**
 * STR G05 — Deliverable Detail Page
 * Shows version history + review form (lead/steward).
 */
export default async function DeliverableDetailPage({ params }: { params: Promise<{ locale: string; id: string; did: string }> }) {
  const { locale, id, did } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`);
  }

  let deliverable;
  try {
    deliverable = await getDeliverable(did, session.user.id);
  } catch {
    notFound();
  }
  if (!deliverable) notFound();

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/projects/${id}/workspace`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← مساحة العمل" : "← Workspace"}
          </Link>
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "المخرج" : "Deliverable"}
          </h1>
        </header>

        <DeliverableDetailClient
          deliverable={deliverable}
          projectId={id}
          locale={locale}
          currentUserId={session.user.id}
        />
      </div>
    </div>
  );
}
