"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { useLocale } from "next-intl";
import { SiteHeader } from "@/components/shared/site-header";
import { SiteFooter } from "@/components/shared/site-footer";

export default function DashboardPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{t("signinTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/auth/signin">{t("signinButton")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col"
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <SiteHeader />
      <div className="container mx-auto px-4 sm:px-6 py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <CardTitle>{t("dashboardTitle")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("dashboardWelcome")}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">ID:</span> {session.user.id}</p>
              <p><span className="text-muted-foreground">Email:</span> {session.user.email}</p>
              <p><span className="text-muted-foreground">Role:</span> {session.user.role}</p>
              <p><span className="text-muted-foreground">Locale:</span> {session.user.locale}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
