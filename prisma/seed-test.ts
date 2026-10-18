/**
 * STR Platform — TEST-ONLY Seed (G03-E2E-ROOT)
 * --------------------------------------------
 * Creates institutional test accounts with Argon2id-hashed passwords
 * for Playwright E2E tests. This file is NEVER used in production.
 *
 * Run: bun run prisma/seed-test.ts
 * CI: the e2e job runs this AFTER the production seed.
 *
 * Accounts created:
 *   - reviewer@str.platform.local / ReviewerPass123! (has reviewer role)
 *   - steward@str.platform.local / StewardPass123! (has steward role)
 *   - member@str.platform.local / MemberPass123! (regular member)
 *
 * SECURITY: These passwords are test-only. They are NEVER deployed to
 * production. The production seed (prisma/seed.ts) does NOT create
 * password-enabled accounts.
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/identity/password";

const prisma = new PrismaClient();

async function main() {
  console.log("→ STR test seed: starting (institutional accounts)");

  // Reviewer — has "reviewer" role + password.
  const reviewerHash = await hashPassword("ReviewerPass123!");
  await prisma.user.upsert({
    where: { email: "reviewer@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "reviewer@str.platform.local" } },
          update: { passwordHash: reviewerHash },
          create: {
            provider: "password",
            providerSub: "reviewer@str.platform.local",
            emailAtLink: "reviewer@str.platform.local",
            passwordHash: reviewerHash,
          },
        },
      },
    },
    create: {
      email: "reviewer@str.platform.local",
      displayName: "STR Reviewer (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "reviewer", scope: "global" },
        ],
      },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "reviewer@str.platform.local",
          emailAtLink: "reviewer@str.platform.local",
          passwordHash: reviewerHash,
        },
      },
      profile: { create: { displayName: "STR Reviewer", visibility: { create: {} } } },
    },
  });

  // Steward — has "steward" role + password.
  const stewardHash = await hashPassword("StewardPass123!");
  await prisma.user.upsert({
    where: { email: "steward@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "steward@str.platform.local" } },
          update: { passwordHash: stewardHash },
          create: {
            provider: "password",
            providerSub: "steward@str.platform.local",
            emailAtLink: "steward@str.platform.local",
            passwordHash: stewardHash,
          },
        },
      },
    },
    create: {
      email: "steward@str.platform.local",
      displayName: "STR Steward (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "steward", scope: "global" },
        ],
      },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "steward@str.platform.local",
          emailAtLink: "steward@str.platform.local",
          passwordHash: stewardHash,
        },
      },
      profile: { create: { displayName: "STR Steward", visibility: { create: {} } } },
    },
  });

  // Regular member — has "member" role only + password.
  const memberHash = await hashPassword("MemberPass123!");
  await prisma.user.upsert({
    where: { email: "member@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "member@str.platform.local" } },
          update: { passwordHash: memberHash },
          create: {
            provider: "password",
            providerSub: "member@str.platform.local",
            emailAtLink: "member@str.platform.local",
            passwordHash: memberHash,
          },
        },
      },
    },
    create: {
      email: "member@str.platform.local",
      displayName: "STR Member (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: { create: { role: "member", scope: "global" } },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "member@str.platform.local",
          emailAtLink: "member@str.platform.local",
          passwordHash: memberHash,
        },
      },
      profile: { create: { displayName: "STR Member", visibility: { create: {} } } },
    },
  });

  // G06 — Institutional roles: admin, partnership_manager, moderator
  const adminHash = await hashPassword("AdminPass123!");
  await prisma.user.upsert({
    where: { email: "test-admin@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "test-admin@str.platform.local" } },
          update: { passwordHash: adminHash },
          create: {
            provider: "password",
            providerSub: "test-admin@str.platform.local",
            emailAtLink: "test-admin@str.platform.local",
            passwordHash: adminHash,
          },
        },
      },
    },
    create: {
      email: "test-admin@str.platform.local",
      displayName: "STR Admin (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "reviewer", scope: "global" },
          { role: "admin", scope: "global" },
        ],
      },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "test-admin@str.platform.local",
          emailAtLink: "test-admin@str.platform.local",
          passwordHash: adminHash,
        },
      },
      profile: { create: { displayName: "STR Admin", visibility: { create: {} } } },
    },
  });

  const pmHash = await hashPassword("PartnershipManagerPass123!");
  await prisma.user.upsert({
    where: { email: "partnership_manager@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "partnership_manager@str.platform.local" } },
          update: { passwordHash: pmHash },
          create: {
            provider: "password",
            providerSub: "partnership_manager@str.platform.local",
            emailAtLink: "partnership_manager@str.platform.local",
            passwordHash: pmHash,
          },
        },
      },
    },
    create: {
      email: "partnership_manager@str.platform.local",
      displayName: "STR Partnership Manager (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "partnership_manager", scope: "global" },
        ],
      },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "partnership_manager@str.platform.local",
          emailAtLink: "partnership_manager@str.platform.local",
          passwordHash: pmHash,
        },
      },
      profile: { create: { displayName: "STR PM", visibility: { create: {} } } },
    },
  });

  const modHash = await hashPassword("ModeratorPass123!");
  await prisma.user.upsert({
    where: { email: "moderator@str.platform.local" },
    update: {
      status: "ACTIVE",
      emailVerified: new Date(),
      authIdentities: {
        upsert: {
          where: { provider_providerSub: { provider: "password", providerSub: "moderator@str.platform.local" } },
          update: { passwordHash: modHash },
          create: {
            provider: "password",
            providerSub: "moderator@str.platform.local",
            emailAtLink: "moderator@str.platform.local",
            passwordHash: modHash,
          },
        },
      },
    },
    create: {
      email: "moderator@str.platform.local",
      displayName: "STR Moderator (test)",
      locale: "ar",
      status: "ACTIVE",
      emailVerified: new Date(),
      roleGrants: {
        create: [
          { role: "member", scope: "global" },
          { role: "moderator", scope: "global" },
        ],
      },
      authIdentities: {
        create: {
          provider: "password",
          providerSub: "moderator@str.platform.local",
          emailAtLink: "moderator@str.platform.local",
          passwordHash: modHash,
        },
      },
      profile: { create: { displayName: "STR Moderator", visibility: { create: {} } } },
    },
  });

  console.log("✓ STR test seed: complete (reviewer + steward + member + admin + partnership_manager + moderator with passwords)");
}

main()
  .catch((e) => {
    console.error("✗ STR test seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
