import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listComplaints } from "@/modules/moderation/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ModerationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let complaints: Awaited<ReturnType<typeof listComplaints>> = [];
  try {
    complaints = await listComplaints(session.user.id);
  } catch {
    // Non-moderator/admin → empty
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header><h1 className="text-3xl font-bold">{locale === "ar" ? "طابور الإشراف" : "Moderation Queue"}</h1></header>
        {complaints.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">
            {locale === "ar" ? "لا توجد شكاوى، أو ليس لديك صلاحية." : "No complaints, or you lack access."}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {complaints.map((c) => (
              <Link key={c.id} href={`/${locale}/moderation/${c.id}`}>
                <Card><CardContent className="pt-6 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{c.reason.substring(0, 80)}{c.reason.length > 80 ? "..." : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale === "ar" ? "المُشتكي:" : "Complainant:"} {c.complainant.displayName || c.complainant.email}
                      {c.targetUser && ` • ${locale === "ar" ? "الهدف:" : "Target:"} ${c.targetUser.displayName || c.targetUser.email}`}
                    </p>
                  </div>
                  <Badge variant={c.status === "ESCALATED" ? "destructive" : "secondary"}>{c.status}</Badge>
                </CardContent></Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
