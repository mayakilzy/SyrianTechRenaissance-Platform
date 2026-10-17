/**
 * STR Profiles — Profile Service
 * ------------------------------
 * CRUD for MemberProfile with ownership enforcement. All mutations go
 * through the authorization service (authorize.ts) — no direct DB writes
 * without a ownership check.
 *
 * See 02-Architecture §3 (module boundaries) and
 *     03-Data-and-Permissions §"Privacy defaults".
 */

import { db } from "@/lib/db";
import { can } from "@/modules/governance/authorize";
import { NotFoundError, ForbiddenError, ValidationError } from "@/lib/errors";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(100),
  headline: z.string().max(120).optional(),
  bio: z.string().max(5000).optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  contactEmail: z.string().email().optional().or(z.literal("")),
  location: z.string().max(200).optional(),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  availability: z.enum(["OPEN", "LIMITED", "CLOSED"]).optional(),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const visibilityUpdateSchema = z.object({
  showContact: z.boolean().optional(),
  showLocation: z.boolean().optional(),
  showSkills: z.boolean().optional(),
  showPortfolio: z.boolean().optional(),
  showAvailability: z.boolean().optional(),
});

export type VisibilityUpdate = z.infer<typeof visibilityUpdateSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicProfile {
  id: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  websiteUrl: string | null;
  availability: string | null;
  skills: { name: string; level: string }[];
  portfolio: {
    id: string;
    title: string;
    description: string | null;
    url: string | null;
  }[];
  completenessPct: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Get the current user's own profile (full data, no visibility filtering).
 */
export async function getOwnProfile(userId: string) {
  const profile = await db.memberProfile.findUnique({
    where: { userId },
    include: {
      skills: { include: { skill: true } },
      portfolio: true,
      visibility: true,
    },
  });
  if (!profile) {
    throw new NotFoundError("Profile not found");
  }
  return profile;
}

/**
 * Get a public profile view, respecting visibility settings.
 * The auth email is NEVER included; only contactEmail when showContact=true.
 */
export async function getPublicProfile(profileId: string): Promise<PublicProfile> {
  const profile = await db.memberProfile.findUnique({
    where: { id: profileId },
    include: {
      skills: { include: { skill: true } },
      portfolio: true,
      visibility: true,
    },
  });

  if (!profile) {
    throw new NotFoundError("Profile not found");
  }

  const vis = profile.visibility;

  return {
    id: profile.id,
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    location: vis?.showLocation ? profile.location : null,
    websiteUrl: profile.websiteUrl,
    availability: vis?.showAvailability ? profile.availability : null,
    skills: vis?.showSkills
      ? profile.skills.map((ms) => ({ name: ms.skill.name, level: ms.level }))
      : [],
    portfolio: vis?.showPortfolio
      ? profile.portfolio.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          url: p.url,
        }))
      : [],
    completenessPct: profile.completenessPct,
  };
}

/**
 * Update the current user's own profile. Enforces ownership via authorize().
 */
export async function updateOwnProfile(
  userId: string,
  input: ProfileUpdate,
): Promise<void> {
  // Authorization: user must own the profile.
  const profile = await db.memberProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new NotFoundError("Profile not found");
  }

  const result = await can(userId, "profile:update:own", {
    kind: "profile",
    id: profile.id,
    ownerId: userId,
  });
  if (!result.allowed) {
    throw new ForbiddenError(result.reason ?? "access denied");
  }

  const valid = profileUpdateSchema.safeParse(input);
  if (!valid.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of valid.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Invalid profile data", fields);
  }

  // Recalculate completeness percentage.
  const data = valid.data;
  const completeness = calculateCompleteness(data);

  await db.memberProfile.update({
    where: { userId },
    data: {
      displayName: data.displayName,
      headline: data.headline || null,
      bio: data.bio || null,
      avatarUrl: data.avatarUrl || null,
      contactEmail: data.contactEmail || null,
      location: data.location || null,
      websiteUrl: data.websiteUrl || null,
      availability: data.availability || "CLOSED",
      completenessPct: completeness,
    },
  });
}

/**
 * Update profile visibility settings. Only the owner can change these.
 */
export async function updateVisibility(
  userId: string,
  input: VisibilityUpdate,
): Promise<void> {
  const profile = await db.memberProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new NotFoundError("Profile not found");
  }

  const result = await can(userId, "profile:update:own", {
    kind: "profile",
    id: profile.id,
    ownerId: userId,
  });
  if (!result.allowed) {
    throw new ForbiddenError(result.reason ?? "access denied");
  }

  const valid = visibilityUpdateSchema.safeParse(input);
  if (!valid.success) {
    throw new ValidationError("Invalid visibility data");
  }

  await db.profileVisibility.upsert({
    where: { profileId: profile.id },
    update: valid.data,
    create: { profileId: profile.id, ...valid.data },
  });
}

// ---------------------------------------------------------------------------
// Completeness calculation
// ---------------------------------------------------------------------------

/** Calculate profile completeness as a percentage (0-100). */
export function calculateCompleteness(data: Partial<ProfileUpdate>): number {
  const fields = [
    "displayName",
    "headline",
    "bio",
    "avatarUrl",
    "contactEmail",
    "location",
    "websiteUrl",
  ] as const;
  const filled = fields.filter((f) => {
    const v = data[f];
    return v && v.trim().length > 0;
  }).length;
  return Math.round((filled / fields.length) * 100);
}
