import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOrganization, listRepresentatives } from "@/modules/organizations/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * STR G06-A — Organization detail
 */
export default async function OrganizationDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let org: Awaited<ReturnType<typeof getOrganization>>;
  let reps: Awaited<ReturnType<typeof listRepresentatives>> = [];
  try {
    org = await getOrganization(id, session.user.id);
    reps = await listRepresentatives(id, session.user.id);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <Link href={`/${locale}/organizations`} className="text-sm text-muted-foreground hover:underline">
            {locale === "ar" ? "← العودة إلى المنظمات" : "← Back to organizations"}
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">{org.legalName}</h1>
            <Badge variant={org.status === "ACTIVE" ? "default" : "secondary"}>{org.status}</Badge>
          </div>
          <p className="text-muted-foreground">{org.email}</p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{locale === "ar" ? "الممثلون المعتمدون" : "Verified Representatives"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reps.length === 0 ? (
              <p className="text-muted-foreground">
                {locale === "ar" ? "لا يوجد ممثلون معتمدون." : "No representatives."}
              </p>
            ) : (
              reps.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="font-medium">{r.user.displayName || r.user.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.role} • {r.delegatedAuthorityScope.substring(0, 100)}{r.delegatedAuthorityScope.length > 100 ? "..." : ""}
                    </p>
                  </div>
                  <Badge variant={r.verifiedAt ? "default" : "outline"}>
                    {r.verifiedAt ? (locale === "ar" ? "موثَّق" : "Verified") : (locale === "ar" ? "غير موثَّق" : "Unverified")}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
