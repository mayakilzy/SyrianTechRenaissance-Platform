import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getAdminDashboardStats } from "@/modules/admin/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  let stats: Awaited<ReturnType<typeof getAdminDashboardStats>> | null = null;
  try {
    stats = await getAdminDashboardStats(session.user.id);
  } catch {
    // Non-admin → empty state
  }

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-4">
          <h1 className="text-2xl sm:text-3xl font-bold">{locale === "ar" ? "لوحة الإدارة" : "Admin Dashboard"}</h1>
          <nav className="flex flex-wrap gap-2" role="navigation" aria-label={locale === "ar" ? "تنقل الإدارة" : "Admin navigation"}>
            <Link href={`/${locale}/admin`} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground">{locale === "ar" ? "نظرة عامة" : "Overview"}</Link>
            <Link href={`/${locale}/organizations`} className="px-3 py-1.5 text-sm rounded-md hover:bg-muted">{locale === "ar" ? "المنظمات" : "Organizations"}</Link>
            <Link href={`/${locale}/partnerships`} className="px-3 py-1.5 text-sm rounded-md hover:bg-muted">{locale === "ar" ? "الشراكات" : "Partnerships"}</Link>
            <Link href={`/${locale}/moderation`} className="px-3 py-1.5 text-sm rounded-md hover:bg-muted">{locale === "ar" ? "الإشراف" : "Moderation"}</Link>
            <Link href={`/${locale}/integrations`} className="px-3 py-1.5 text-sm rounded-md hover:bg-muted">{locale === "ar" ? "التكاملات" : "Integrations"}</Link>
          </nav>
        </header>
        {!stats ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {locale === "ar" ? "ليس لديك صلاحية الإدارة." : "You do not have admin access."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "المقترحات" : "Proposals"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{locale === "ar" ? "معلَّقة:" : "Pending:"} {stats.proposals.pending}</p>
                <p>{locale === "ar" ? "معتمدة:" : "Approved:"} {stats.proposals.approved}</p>
                <p>{locale === "ar" ? "مرفوضة:" : "Rejected:"} {stats.proposals.rejected}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "المشاريع" : "Projects"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{locale === "ar" ? "نشطة:" : "Active:"} {stats.projects.active}</p>
                <p>{locale === "ar" ? "معلَّقة:" : "Suspended:"} {stats.projects.suspended}</p>
                <p>{locale === "ar" ? "مكتملة:" : "Completed:"} {stats.projects.completed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "المنظمات" : "Organizations"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{locale === "ar" ? "بانتظار التحقق:" : "Pending verification:"} {stats.organizations.pending}</p>
                <p>{locale === "ar" ? "نشطة:" : "Active:"} {stats.organizations.active}</p>
                <p>{locale === "ar" ? "معلَّقة:" : "Suspended:"} {stats.organizations.suspended}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "الشراكات" : "Partnerships"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{locale === "ar" ? "معلَّقة:" : "Pending:"} {stats.partnerships.pending}</p>
                <p>{locale === "ar" ? "معتمدة:" : "Approved:"} {stats.partnerships.approved}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "الإشراف" : "Moderation"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{locale === "ar" ? "مفتوحة:" : "Open:"} {stats.moderation.open}</p>
                <p>{locale === "ar" ? "مصعَّدة:" : "Escalated:"} {stats.moderation.escalated}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{locale === "ar" ? "روابط سريعة" : "Quick links"}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Link href={`/${locale}/organizations`} className="block text-primary hover:underline">{locale === "ar" ? "المنظمات" : "Organizations"}</Link>
                <Link href={`/${locale}/partnerships`} className="block text-primary hover:underline">{locale === "ar" ? "الشراكات" : "Partnerships"}</Link>
                <Link href={`/${locale}/moderation`} className="block text-primary hover:underline">{locale === "ar" ? "الإشراف" : "Moderation"}</Link>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
