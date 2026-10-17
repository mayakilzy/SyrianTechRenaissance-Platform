/**
 * STR Identity — Client-Safe Config Checks
 * ----------------------------------------
 * These functions are safe to import from client components ("use client").
 * They read ONLY public environment variables (NEXT_PUBLIC_*) and never
 * pull in server-only modules like @node-rs/argon2 or the Prisma client.
 *
 * Server-only config lives in src/modules/identity/auth-config.ts.
 * Do NOT import auth-config.ts from client code — it transitively imports
 * argon2 (native module) and Prisma, which breaks the client bundle.
 */

/**
 * Whether the Google OIDC provider is configured.
 * Uses a NEXT_PUBLIC_ flag set at build time by the server config.
 * When false, the "Continue with Google" button is hidden.
 */
export function isGoogleProviderConfiguredClient(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
}
