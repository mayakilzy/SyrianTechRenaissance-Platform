/**
 * STR Talent — Talent Directory Service (G04-02 fixed)
 * ----------------------------------------------------
 * Search and filter professional profiles respecting visibility settings.
 *
 * G04-02 FIX: visibility is now enforced in the WHERE clause, not just
 * the SELECT. This means:
 *   - If showSkills=false, searching by skill won't match that profile
 *   - If showPortfolio=false, portfolio content isn't searchable
 *   - bio is always searchable (it's the profile's public summary)
 *   - total count matches the visible results (no hidden matches)
 */

import { db } from "@/lib/db";
import { z } from "zod/v4";

export interface PublicTalentProfile {
  id: string;
  userId: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  availability: string | null;
  skills: { name: string; level: string }[];
  portfolio: { id: string; title: string; url: string | null }[];
}

export const searchSchema = z.object({
  query: z.string().max(200).optional(),
  skill: z.string().max(100).optional(),
  availability: z.enum(["OPEN", "LIMITED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchParams = z.infer<typeof searchSchema>;

/**
 * Search talent profiles with pagination.
 *
 * VISIBILITY ENFORCEMENT (G04-02 §A):
 *   - bio: always searchable (it's the public summary)
 *   - displayName, headline: always searchable (public identity)
 *   - skills: ONLY searchable if the profile's visibility.showSkills=true
 *   - availability: ONLY filterable if visibility.showAvailability=true
 *   - location: never searchable (private unless showLocation=true, but
 *     we don't expose it in search to avoid location-based enumeration)
 *
 * This means a profile with showSkills=false will NOT appear in skill-based
 * search results, even if it has the matching skill. The total count
 * reflects only visible matches.
 */
export async function searchTalent(params: SearchParams): Promise<{
  results: PublicTalentProfile[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { query, skill, availability, page, pageSize } = params;
  const skip = (page - 1) * pageSize;

  // Build WHERE clause with visibility-aware conditions.
  const where: Record<string, unknown> = {
    user: { status: "ACTIVE" },
  };

  // Text search: only on public fields (displayName, headline, bio).
  if (query) {
    where.OR = [
      { displayName: { contains: query, mode: "insensitive" } },
      { headline: { contains: query, mode: "insensitive" } },
      { bio: { contains: query, mode: "insensitive" } },
    ];
  }

  // Availability filter: only if the profile shows availability publicly.
  if (availability) {
    where.AND = [
      { availability },
      { visibility: { showAvailability: true } },
    ];
  }

  // Skill filter: only match profiles that show skills publicly.
  if (skill) {
    where.AND = [
      ...(where.AND as unknown[] || []),
      { visibility: { showSkills: true } },
      {
        skills: {
          some: {
            skill: {
              normalizedName: { contains: skill.toLowerCase(), mode: "insensitive" },
            },
          },
        },
      },
    ];
  }

  const [profiles, total] = await Promise.all([
    db.memberProfile.findMany({
      where,
      include: {
        skills: { include: { skill: true } },
        portfolio: true,
        visibility: true,
        user: { select: { status: true } },
      },
      skip,
      take: pageSize,
      orderBy: { updatedAt: "desc" },
    }),
    db.memberProfile.count({ where }),
  ]);

  const results: PublicTalentProfile[] = profiles.map((p) => {
    const vis = p.visibility;
    return {
      id: p.id,
      userId: p.userId,
      displayName: p.displayName,
      headline: p.headline,
      bio: p.bio,
      avatarUrl: p.avatarUrl,
      location: vis?.showLocation ? p.location : null,
      availability: vis?.showAvailability ? p.availability : null,
      skills: vis?.showSkills
        ? p.skills.map((ms) => ({ name: ms.skill.name, level: ms.level }))
        : [],
      portfolio: vis?.showPortfolio
        ? p.portfolio.map((item) => ({ id: item.id, title: item.title, url: item.url }))
        : [],
    };
  });

  return { results, total, page, pageSize };
}

/**
 * Get a single public talent profile by ID.
 * Returns null if the profile doesn't exist or the user is not active.
 * Respects visibility settings.
 */
export async function getPublicTalentProfile(profileId: string): Promise<PublicTalentProfile | null> {
  const profile = await db.memberProfile.findUnique({
    where: { id: profileId },
    include: {
      skills: { include: { skill: true } },
      portfolio: true,
      visibility: true,
      user: { select: { status: true } },
    },
  });

  if (!profile || profile.user.status !== "ACTIVE") return null;

  const vis = profile.visibility;
  return {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    location: vis?.showLocation ? profile.location : null,
    availability: vis?.showAvailability ? profile.availability : null,
    skills: vis?.showSkills
      ? profile.skills.map((ms) => ({ name: ms.skill.name, level: ms.level }))
      : [],
    portfolio: vis?.showPortfolio
      ? profile.portfolio.map((item) => ({ id: item.id, title: item.title, url: item.url }))
      : [],
  };
}
