import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowRight, ArrowLeft, Building2, GraduationCap, Wrench, Heart, ShieldCheck, Network, FlaskConical, FileCheck2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SiteFooter } from "@/components/shared/site-footer";
import { SiteHeader } from "@/components/shared/site-header";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home" });

  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  const pillars = [
    { icon: Building2, titleKey: "pillarEconomic", descKey: "pillarEconomicDesc" },
    { icon: Heart, titleKey: "pillarDevelopmental", descKey: "pillarDevelopmentalDesc" },
    { icon: GraduationCap, titleKey: "pillarEducational", descKey: "pillarEducationalDesc" },
    { icon: Wrench, titleKey: "pillarEngineering", descKey: "pillarEngineeringDesc" },
  ] as const;

  const principles = [
    { icon: ShieldCheck, titleKey: "principleNeutral", descKey: "principleNeutralDesc" },
    { icon: Network, titleKey: "principleGovernance", descKey: "principleGovernanceDesc" },
    { icon: FlaskConical, titleKey: "principleIntegration", descKey: "principleIntegrationDesc" },
    { icon: FileCheck2, titleKey: "principleEvidence", descKey: "principleEvidenceDesc" },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      {/* ─── Hero ─── */}
      <section className="container mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <Badge variant="secondary" className="mb-6">
          {t("statusG01")}
        </Badge>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight max-w-4xl mx-auto leading-tight">
          {t("heroTitle")}
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          {t("heroSubtitle")}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" asChild>
            <Link href="#mission">
              {t("heroCtaPrimary")}
              <Arrow className="ms-2 w-4 h-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="#principles">{t("heroCtaSecondary")}</Link>
          </Button>
        </div>
      </section>

      {/* ─── Pillars ─── */}
      <section id="mission" className="container mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
            {t("pillarsTitle")}
          </h2>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
            {t("pillarsSubtitle")}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {pillars.map(({ icon: Icon, titleKey, descKey }) => (
            <Card key={titleKey} className="border-border/60 hover:border-primary/40 transition-colors">
              <CardHeader>
                <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                  <Icon className="w-5 h-5" />
                </div>
                <CardTitle className="text-lg">{t(titleKey)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t(descKey)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ─── Principles ─── */}
      <section id="principles" className="bg-card/30 border-y border-border/60">
        <div className="container mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight">
              {t("principlesTitle")}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-4xl mx-auto">
            {principles.map(({ icon: Icon, titleKey, descKey }) => (
              <Card key={titleKey} className="border-border/60">
                <CardContent className="pt-6 flex gap-4">
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{t(titleKey)}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(descKey)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Status ─── */}
      <section className="container mx-auto px-4 sm:px-6 py-16">
        <Card className="max-w-3xl mx-auto border-dashed">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">{t("statusTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("statusNote")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge variant="outline">Next.js</Badge>
              <Badge variant="outline">PostgreSQL</Badge>
              <Badge variant="outline">RTL · LTR</Badge>
            </div>
          </CardContent>
        </Card>
      </section>

      <SiteFooter />
    </div>
  );
}
