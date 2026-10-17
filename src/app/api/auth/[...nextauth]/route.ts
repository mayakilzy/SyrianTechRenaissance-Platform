/**
 * STR API — NextAuth Handler
 * /api/auth/[...nextauth]
 *
 * Handles all Auth.js routes: sign-in, sign-out, session, callback.
 * Google OIDC is active ONLY when GOOGLE_CLIENT_ID/SECRET are configured.
 */

import NextAuth from "next-auth";
import { getAuthOptions } from "@/modules/identity/auth-config";

const handler = NextAuth(getAuthOptions());

export { handler as GET, handler as POST };
