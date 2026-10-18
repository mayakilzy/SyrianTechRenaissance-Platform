import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getThread } from "@/modules/communications/threads";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ThreadDetailPage({ params }: { params: Promise<{ locale: string; id: string; tid: string }> }) {
  const { locale, id, tid } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let thread: Awaited<ReturnType<typeof getThread>>;
  try {
    thread = await getThread(tid, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/projects/${id}/threads`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← المحادثات" : "← Threads"}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{thread.title}</h1>
            {thread.closedAt && <Badge variant="secondary">{locale === "ar" ? "مغلقة" : "Closed"}</Badge>}
          </div>
        </header>
        <div className="space-y-3">
          {thread.messages.map((m) => (
            <Card key={m.id}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">{m.author.displayName || m.author.email}</p>
                  <p className="text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</p>
                </div>
                <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">{m.body}</pre>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
