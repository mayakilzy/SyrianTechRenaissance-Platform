import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getComplaint } from "@/modules/moderation/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ComplaintDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let complaint: Awaited<ReturnType<typeof getComplaint>>;
  try {
    complaint = await getComplaint(id, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/moderation`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← طابور الإشراف" : "← Moderation queue"}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{locale === "ar" ? "شكوى" : "Complaint"}</h1>
            <Badge variant="secondary">{complaint.status}</Badge>
          </div>
        </header>
        <Card>
          <CardHeader><CardTitle>{locale === "ar" ? "السبب" : "Reason"}</CardTitle></CardHeader>
          <CardContent><pre className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">{complaint.reason}</pre></CardContent>
        </Card>
        {complaint.evidenceText && (
          <Card>
            <CardHeader><CardTitle>{locale === "ar" ? "الأدلة المقتبَسة" : "Quoted evidence"}</CardTitle></CardHeader>
            <CardContent><pre className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">{complaint.evidenceText}</pre></CardContent>
          </Card>
        )}
        {complaint.decisions.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{locale === "ar" ? "سجل القرارات" : "Decision history"}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {complaint.decisions.map((d) => (
                <div key={d.id} className="border rounded p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(d.decidedAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm mt-1">{d.reason}</p>
                  <p className="text-xs text-muted-foreground">{d.decider.displayName || d.decider.email}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
