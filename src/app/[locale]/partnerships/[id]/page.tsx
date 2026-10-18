import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getPartnershipRequest } from "@/modules/partnerships/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * STR G06-A — Partnership request detail
 */
export default async function PartnershipDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let req: Awaited<ReturnType<typeof getPartnershipRequest>>;
  try {
    req = await getPartnershipRequest(id, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/partnerships`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← طلبات الشراكة" : "← Partnership requests"}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{req.organization.displayName}</h1>
            <Badge variant={req.status === "APPROVED" ? "default" : "secondary"}>{req.status}</Badge>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "نص الطلب" : "Proposal text"}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded">{req.proposalText}</pre>
          </CardContent>
        </Card>

        {req.decisions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "سجل القرارات" : "Decision history"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {req.decisions.map((d) => (
                <div key={d.id} className="border rounded p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(d.decidedAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm mt-1">{d.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === "ar" ? "بواسطة:" : "By:"} {d.decider.displayName || d.decider.email}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {req.agreement && (
          <Card>
            <CardHeader>
              <CardTitle>{locale === "ar" ? "مرجع الاتفاقية" : "Agreement reference"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-sm">{req.agreement.fileName}</p>
              <Badge variant={req.agreement.scanStatus === "CLEAN" ? "default" : "outline"}>
                {req.agreement.scanStatus}
              </Badge>
              {req.agreementSuspendedAt && (
                <p className="text-xs text-destructive mt-2">
                  {locale === "ar" ? "تم تعليق الاعتماد التشغيلي على الاتفاقية." : "Operational reliance on this agreement has been suspended."}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
