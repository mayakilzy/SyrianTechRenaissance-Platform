import { getServerSession } from "next-auth";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProfileShell } from "@/components/shell/profile-shell";
import { getAuthOptions } from "@/modules/identity/auth-config";
import { getOwnProfile } from "@/modules/profiles/service";
import { ProfileEditForm } from "./edit-form";
import type { Locale } from "@/i18n/config";

export default async function EditProfilePage({
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

  let profile: Awaited<ReturnType<typeof getOwnProfile>>;
  try {
    profile = await getOwnProfile(session.user.id);
  } catch {
    return notFound();
  }

  const profileData = {
    displayName: profile.displayName,
    headline: profile.headline || "",
    bio: profile.bio || "",
    avatarUrl: profile.avatarUrl || "",
    contactEmail: profile.contactEmail || "",
    location: profile.location || "",
    websiteUrl: profile.websiteUrl || "",
    availability: profile.availability,
  };

  return (
    <ProfileShell>
      <ProfileEditForm initialData={profileData} locale={loc} />
    </ProfileShell>
  );
}
