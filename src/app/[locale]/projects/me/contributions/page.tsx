import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { listMyContributions } from "@/modules/projects/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * STR G05 — My Contributions Page
 * Lists contribution references across all projects for the authenticated user.
 */
export default async function MyContributionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    redirect(`/${locale}/auth/signin`);
  }

  const contributions = await listMyContributions(session.user.id);

  return (
    <div className="min-h-screen bg-background" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">
            {locale === "ar" ? "مساهماتي" : "My Contributions"}
          </h1>
          <p className="text-muted-foreground">
            {locale === "ar"
              ? `إجمالي المساهمات المعتمدة: ${contributions.length}`
              : `Total accepted contributions: ${contributions.length}`}
          </p>
        </header>

        {contributions.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              {locale === "ar"
                ? "لا توجد مساهمات معتمدة بعد."
                : "No accepted contributions yet."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {contributions.map((c) => (
              <Card key={c.id}>
                <CardContent className="pt-6 space-y-2">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/${locale}/projects/${c.project.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.project.title}
                    </Link>
                    <Badge variant={c.project.status === "ACTIVE" ? "default" : "secondary"}>
                      {c.project.status}
                    </Badge>
                  </div>
                  <p className="text-sm">{c.attributionText}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === "ar" ? "المهمة:" : "Task:"} {c.deliverable.task.title}
                    {" • "}
                    {locale === "ar" ? "النسخة:" : "Version:"} v{c.acceptedVersion}
                    {" • "}
                    {locale === "ar" ? "تاريخ القبول:" : "Accepted:"} {new Date(c.acceptedAt).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
