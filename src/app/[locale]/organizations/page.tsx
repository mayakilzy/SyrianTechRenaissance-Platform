import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listOrganizations } from "@/modules/organizations/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";

/**
 * STR G06-A — Organizations list (admin only)
 */
export default async function OrganizationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let organizations: Awaited<ReturnType<typeof listOrganizations>> = [];
  try {
    organizations = await listOrganizations(session.user.id);
  } catch {
    // Non-admin → 404-like empty state
  }

  return (
    <div className="min-h-screen bg-background flex flex-col"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <SiteHeader />
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header>
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "المنظمات الشريكة" : "Partner Organizations"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {locale === "ar" ? "إدارة المنظمات والممثلين والتحقق من التفويض" : "Manage organizations, representatives, and authority verification"}
          </p>
        </header>
        {organizations.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {locale === "ar" ? "لا توجد منظمات بعد، أو ليس لديك صلاحية الإدارة." : "No organizations yet, or you lack admin access."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {organizations.map((org) => (
              <Link key={org.id} href={`/${locale}/organizations/${org.id}`}>
                <Card>
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{org.legalName}</p>
                      <p className="text-sm text-muted-foreground">{org.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {locale === "ar" ? "ممثلون:" : "Reps:"} {org._count.representatives}
                      </span>
                      <Badge variant={org.status === "ACTIVE" ? "default" : "secondary"}>{org.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
