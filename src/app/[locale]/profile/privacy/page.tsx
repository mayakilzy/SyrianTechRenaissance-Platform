import { getServerSession } from "next-auth";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProfileShell } from "@/components/shell/profile-shell";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOwnProfile } from "@/modules/profiles/service";
import { PrivacySettingsForm } from "./privacy-form";
import type { Locale } from "@/i18n/config";

export default async function PrivacySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale as Locale;
  setRequestLocale(loc);

  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.id) {
    return notFound();
  }

  let visibility: {
    showContact: boolean; showLocation: boolean; showSkills: boolean;
    showPortfolio: boolean; showAvailability: boolean;
  };

  try {
    const profile = await getOwnProfile(session.user.id);
    visibility = profile.visibility || {
      showContact: false,
      showLocation: false,
      showSkills: true,
      showPortfolio: true,
      showAvailability: true,
    };
  } catch {
    return notFound();
  }

  return (
    <ProfileShell>
      <PrivacySettingsForm initialVisibility={visibility} locale={loc} />
    </ProfileShell>
  );
}
