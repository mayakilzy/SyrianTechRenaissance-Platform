import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listPartnershipRequests } from "@/modules/partnerships/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * STR G06-A — Partnerships list (partnership_manager + admin only)
 */
export default async function PartnershipsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let partnerships: Awaited<ReturnType<typeof listPartnershipRequests>> = [];
  try {
    partnerships = (await listPartnershipRequests(session.user.id)) as Awaited<ReturnType<typeof listPartnershipRequests>>;
  } catch {
    // Not authorized → empty state
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header>
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "طلبات الشراكة" : "Partnership Requests"}
          </h1>
        </header>
        {partnerships.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {locale === "ar" ? "لا توجد طلبات شراكة، أو ليس لديك صلاحية." : "No partnership requests, or you lack access."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {partnerships.map((p) => (
              <Link key={p.id} href={`/${locale}/partnerships/${p.id}`}>
                <Card>
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{p.organization.displayName}</p>
                      <p className="text-sm text-muted-foreground">
                        {locale === "ar" ? "الطالب:" : "Requester:"} {p.requester.displayName || p.requester.email}
                      </p>
                    </div>
                    <Badge variant={p.status === "APPROVED" ? "default" : p.status === "REJECTED" ? "destructive" : "secondary"}>
                      {p.status}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
