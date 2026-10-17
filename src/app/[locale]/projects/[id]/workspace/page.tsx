import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getProjectWorkspace } from "@/modules/projects/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * STR G05 — Project Workspace
 * Shows: project info, milestones summary, my tasks, recent deliverables, contributions count.
 * Authorization: team members + lead + steward + admins.
 */
export default async function ProjectWorkspacePage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects" });
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`);
  }

  let workspace;
  try {
    workspace = await getProjectWorkspace(id, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <header className="space-y-2">
          <Link href={`/${locale}/projects/${id}`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← العودة إلى المشروع" : "← Back to project"}
          </Link>
          <h1 className="text-3xl font-bold">{workspace.project.title}</h1>
          <div className="flex items-center gap-2">
            <Badge variant={workspace.project.status === "ACTIVE" ? "default" : "secondary"}>
              {workspace.project.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {locale === "ar" ? "المساهمات:" : "Contributions:"} {workspace.contributionsCount}
            </span>
          </div>
        </header>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "المراحل" : "Milestones"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workspace.milestones.length === 0 ? (
                <p className="text-muted-foreground">
                  {locale === "ar" ? "لا توجد مراحل بعد." : "No milestones yet."}
                </p>
              ) : (
                workspace.milestones.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-2 border rounded">
                    <div>
                      <p className="font-medium">{m.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {locale === "ar" ? "عدد المهام:" : "Tasks:"} {m._count.tasks}
                        {m.dueDate && ` • ${locale === "ar" ? "الاستحقاق:" : "Due:"} ${new Date(m.dueDate).toLocaleDateString()}`}
                      </p>
                    </div>
                    <Badge variant={m.status === "COMPLETED" ? "default" : m.status === "IN_PROGRESS" ? "secondary" : "outline"}>
                      {m.status}
                    </Badge>
                  </div>
                ))
              )}
              <Link href={`/${locale}/projects/${id}/milestones`} className="text-sm text-primary hover:underline">
                {locale === "ar" ? "إدارة المراحل ←" : "Manage milestones ←"}
              </Link>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "مهامي" : "My Tasks"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workspace.myTasks.length === 0 ? (
                <p className="text-muted-foreground">
                  {locale === "ar" ? "لا توجد مهام مخصصة لك." : "No tasks assigned to you."}
                </p>
              ) : (
                workspace.myTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/${locale}/projects/${id}/tasks/${task.id}`}
                    className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {task.deliverables[0]?.status || (locale === "ar" ? "لا مخرج" : "No deliverable")}
                      </p>
                    </div>
                    <Badge variant="outline">{task.status}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "أحدث المخرجات" : "Recent Deliverables"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {workspace.recentDeliverables.length === 0 ? (
                <p className="text-muted-foreground">
                  {locale === "ar" ? "لا توجد مخرجات بعد." : "No deliverables yet."}
                </p>
              ) : (
                workspace.recentDeliverables.map((d) => (
                  <Link
                    key={d.id}
                    href={`/${locale}/projects/${id}/deliverables/${d.id}`}
                    className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">{d.task.title}</p>
                      <p className="text-sm text-muted-foreground">{d.submitter.displayName || d.submitter.email}</p>
                    </div>
                    <Badge variant="outline">{d.status}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
