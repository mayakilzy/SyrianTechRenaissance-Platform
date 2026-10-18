import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listProviders } from "@/modules/integrations/service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function IntegrationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) redirect(`/${locale}/auth/signin`);

  const providers = await listProviders(session.user.id);

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header>
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "دليل الأدوات والتكاملات" : "Tool Directory & Integrations"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {locale === "ar" ? "الموصلات المتاحة للربط مع المشاريع" : "Available providers for project connections"}
          </p>
        </header>
        {providers.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-muted-foreground">
            {locale === "ar" ? "لا توجد موصلات مسجلة بعد." : "No providers registered yet."}
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:gap-4">
            {providers.map((p) => (
              <Card key={p.id}>
                <CardContent className="pt-6 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{p.displayName}</p>
                      {p.isMock && (
                        <Badge variant="outline" className="text-orange-600 border-orange-400">
                          {locale === "ar" ? "تجريبي" : "MOCK"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {locale === "ar" ? "الحالة:" : "Status:"} {p.trustStatus} •
                      {locale === "ar" ? " القدرات:" : " Capabilities:"} {p.capabilities.length}
                    </p>
                  </div>
                  <Badge variant={p.trustStatus === "approved" ? "default" : "secondary"}>
                    {p.trustStatus}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
