import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getTask } from "@/modules/projects/service";
import { TaskDetailClient } from "./TaskDetailClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * STR G05 — Task Detail Page
 * Shows task info + accept button (assignee) + deliverable submission form.
 */
export default async function TaskDetailPage({ params }: { params: Promise<{ locale: string; id: string; tid: string }> }) {
  const { locale, id, tid } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`);
  }

  let task;
  try {
    task = await getTask(tid, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/projects/${id}/workspace`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← مساحة العمل" : "← Workspace"}
          </Link>
          <h1 className="text-3xl font-bold">{task.title}</h1>
          <p className="text-muted-foreground">{task.description}</p>
        </header>

        <TaskDetailClient task={task} projectId={id} locale={locale} currentUserId={session.user.id} />
      </div>
    </div>
  );
}
