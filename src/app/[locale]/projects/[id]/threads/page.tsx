import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listThreads } from "@/modules/communications/threads";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ProjectThreadsPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let threads: Awaited<ReturnType<typeof listThreads>> = [];
  try {
    threads = await listThreads(id, session.user.id);
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
          <h1 className="text-3xl font-bold">{locale === "ar" ? "محادثات المشروع" : "Project Threads"}</h1>
        </header>
        {threads.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">
            {locale === "ar" ? "لا توجد محادثات بعد." : "No threads yet."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {threads.map((t) => (
              <Link key={t.id} href={`/${locale}/projects/${id}/threads/${t.id}`}>
                <Card><CardContent className="pt-6 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale === "ar" ? "الرسائل:" : "Messages:"} {t._count.messages}
                      {t.topic && ` • ${t.topic}`}
                    </p>
                  </div>
                  {t.closedAt && <Badge variant="secondary">{locale === "ar" ? "مغلقة" : "Closed"}</Badge>}
                </CardContent></Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
