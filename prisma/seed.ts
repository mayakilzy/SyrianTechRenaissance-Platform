/**
 * STR Platform — Synthetic Seed Fixtures (G01)
 * --------------------------------------------
 * Idempotent seed for local dev and CI. Produces ONLY synthetic data — no real
 * users, no real providers, no real credentials. Safe to re-run.
 *
 * Run: bun run db:seed  (or: bunx prisma db seed)
 *
 * G01 scope: the mock provider entry + its single capability + one admin user.
 * Full fixtures (proposals, teams, projects) land in G02–G06.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
   
  console.log("→ STR seed: starting (G01 scope)");

  // 1. Mock provider — declared but NOT enabled. Its trust status is
  //    "registered"; G07 governance flow flips it to "approved" then "enabled".
  const provider = await prisma.integrationProvider.upsert({
    where: { slug_version: { slug: "str.mock", version: "1.0.0" } },
    update: {},
    create: {
      id: "str.mock.v1",
      slug: "str.mock",
      version: "1.0.0",
      displayName: "STR Mock Provider (G07 target)",
      description:
        "In-process mock provider used by G07 to exercise the integration core end-to-end. NOT callable in G01.",
      owner: "system",
      baseOrigin: "https://mock.local.str.platform",
      trustStatus: "registered",
      authMode: { kind: "mock" },
      webhookSigning: {
        algorithm: "hmac-sha256",
        headerName: "x-str-signature",
        timestampHeader: "x-str-timestamp",
        replayWindowMs: 300_000,
      },
    },
  });

  // 2. Mock capability — declared, not executable in G01.
  await prisma.integrationCapability.upsert({
    where: { providerId_code: { providerId: provider.id, code: "application.test" } },
    update: {},
    create: {
      providerId: provider.id,
      code: "application.test",
      summary:
        "Mock capability used by G07 to exercise the full registry → connection → job → event flow.",
      executionMode: "async",
      riskClass: "low",
      requiredScopes: ["mock:run"],
      inputSchemaRef: "str.mock.v1/application.test#input",
      outputSchemaRef: "str.mock.v1/application.test#output",
      idempotent: true,
      cancelable: true,
      timeoutMs: 30_000,
    },
  });

  // 3. Synthetic admin user — email is obviously fake; password is unset.
  await prisma.user.upsert({
    where: { email: "admin@str.platform.local" },
    update: {},
    create: {
      email: "admin@str.platform.local",
      displayName: "STR Steward (synthetic)",
      locale: "ar",
      status: "ACTIVE",
    },
  });

   
  console.log("✓ STR seed: complete (provider + capability + synthetic admin)");
}

main()
  .catch((e) => {
     
    console.error("✗ STR seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
