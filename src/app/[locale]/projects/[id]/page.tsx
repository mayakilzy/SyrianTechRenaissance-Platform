import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getTeamForProject } from "@/modules/teams/service";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ProjectDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "projects" });
  const session = await getServerSession(getAuthOptions());

  const project = await db.project.findUnique({
    where: { id },
    include: { proposal: true, lead: { select: { displayName: true } }, steward: { select: { displayName: true } } },
  });
  if (!project) notFound();

  const team = await getTeamForProject(id);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-4xl">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">{project.title}</h1>
            <Badge variant={project.status === "ACTIVE" ? "default" : project.status === "SUSPENDED" ? "destructive" : "secondary"}>{project.status}</Badge>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <Card><CardHeader><CardTitle className="text-lg">{t("lead")}</CardTitle></CardHeader><CardContent><p>{project.lead?.displayName ?? "—"}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-lg">{t("steward")}</CardTitle></CardHeader><CardContent><p>{project.steward?.displayName ?? "—"}</p></CardContent></Card>
        </div>
        {team && (
          <Card>
            <CardHeader><CardTitle className="text-lg">{t("team")} — {team.name}</CardTitle></CardHeader>
            <CardContent>
              <h3 className="font-semibold mb-2">{t("members")}</h3>
              <ul className="space-y-1">
                {team.memberships.map(m => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Badge variant="outline">{m.role}</Badge>
                    <span>{m.user.displayName}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
