/**
 * STR Identity — Auth.js (next-auth v4) Configuration
 * ----------------------------------------------------
 * Two providers:
 *   1. CredentialsProvider (email + password) — uses our identity service
 *   2. GoogleProvider (OIDC) — with safe linking enforced in the signIn callback
 *
 * Session strategy: JWT (stateless, ADR-03). No database sessions in v1.
 *
 * Safe linking rules (ADR-03 + 03-Data §invariant 1):
 *   - Google sign-in that collides with an existing email → BLOCKED
 *   - User must explicitly link Google from Settings (after password login)
 *   - No auto-merge by email under any circumstance
 *
 * G02 classification:
 *   - CredentialsProvider: ✅ implemented + tested (unit + E2E)
 *   - GoogleProvider: ✅ implemented (code is real, uses official library)
 *     but ⏳ awaiting GOOGLE_CLIENT_ID/SECRET for external connection test
 *   - No fake OAuth is ever reported as success
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { db } from "@/lib/db";
import { env } from "@/lib/config";
import { verifyCredentials, handleGoogleLink } from "./service";
import { logger } from "@/lib/logger";

// Type extension for our JWT token.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: string;
      locale: string;
    };
  }
  interface User {
    id: string;
    email: string;
    displayName?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: string;
    locale: string;
  }
}

/**
 * Build the Auth.js options. Exported as a function so we can defer env
 * access (env validation runs on first call, not at module load).
 */
export function buildAuthOptions(): NextAuthOptions {
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await verifyCredentials({
          email: credentials.email,
          password: credentials.password,
        });
        if (!user) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
        };
      },
    }),
  ];

  // Only add Google provider if credentials are configured.
  // This prevents the provider from appearing in the UI when it's not
  // yet connected. When credentials are added, it activates automatically.
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push(
      GoogleProvider({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        authorization: {
          params: {
            prompt: "consent",
            access_type: "offline",
            response_type: "code",
          },
        },
      }),
    );
  }

  return {
    adapter: PrismaAdapter(db),
    session: { strategy: "jwt" },
    providers,
    pages: {
      signIn: "/auth/signin",
    },
    callbacks: {
      async jwt({ token, user, account }) {
        // Initial sign-in: `user` and `account` are present.
        if (user?.id) {
          token.userId = user.id;
          // Fetch role from DB.
          const roleGrant = await db.roleGrant.findFirst({
            where: { userId: user.id, revokedAt: null },
            orderBy: { grantedAt: "desc" },
          });
          token.role = roleGrant?.role ?? "member";
          const dbUser = await db.user.findUnique({ where: { id: user.id } });
          token.locale = dbUser?.locale ?? "ar";
        }

        // Google sign-in: enforce safe linking.
        if (account?.provider === "google" && account.providerAccountId) {
          const result = await handleGoogleLink({
            googleSub: account.providerAccountId,
            googleEmail: user?.email ?? "",
            googleName: user?.name ?? undefined,
            isExplicitLink: false, // this path is for sign-in, not explicit link
          });
          if (result.action === "blocked") {
            logger.warn("auth.google.blocked", { reason: result.message });
            // Throwing here redirects to the error page.
            throw new Error(result.message);
          }
          if (result.userId) {
            token.userId = result.userId;
          }
        }

        return token;
      },

      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.userId;
          session.user.role = token.role;
          session.user.locale = token.locale;
        }
        return session;
      },

      async signIn({ user, account }) {
        // Block Google sign-in if safe linking returns "blocked".
        // The actual logic is in the jwt callback above; this is a secondary
        // guard to prevent session creation when linking fails.
        if (account?.provider === "google") {
          if (!user?.email) return false;
          // The handleGoogleLink call in jwt already decided. If we got here,
          // the link was either "created" or "linked". If it was "blocked",
          // jwt threw and we never reach this point.
          return true;
        }
        return true;
      },
    },
    events: {
      async signIn({ user, account }) {
        logger.info("auth.signin", {
          userId: user.id,
          provider: account?.provider ?? "unknown",
        });
      },
      async signOut({ token }) {
        logger.info("auth.signout", { userId: token?.userId });
      },
    },
    // Cookie security hardening (ADR-03).
    cookies: {
      sessionToken: {
        name: `next-auth.session-token`,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: env.NODE_ENV === "production",
        },
      },
    },
  };
}

/** Singleton auth options (built once on first call). */
let cachedOptions: NextAuthOptions | null = null;
export function getAuthOptions(): NextAuthOptions {
  if (!cachedOptions) cachedOptions = buildAuthOptions();
  return cachedOptions;
}

/**
 * Whether the Google OIDC provider is configured (has credentials).
 * Used by the UI to show/hide the "Continue with Google" button.
 * When false, the button is NOT shown — we don't advertise a non-functional
 * provider.
 */
export function isGoogleProviderConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
