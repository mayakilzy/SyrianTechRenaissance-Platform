# ADR-03: Auth Strategy — Auth.js with Email/Password + Google OIDC

- **Status:** ✅ ACCEPTED for the approach; ⏳ SCAFFOLDED ONLY in G01
- **Date:** 2026-10-17
- **Related:** Decision Register ADR-03, STR-06; 02-Architecture §4; 03-Data-and-Permissions §invariant 1

## Context

STR-06 mandates: email/password with verification AND Google sign-in (OIDC),
with secure account linking. The Engineering Playbook says "Auth.js or proven
secure equivalent; OAuth account-link proof and Google OIDC".

The non-negotiable rules from 03-Data-and-Permissions:
- `(provider, providerSub)` globally unique.
- Email normalized but NEVER trusted as the sole external identity key.
- Google `sub` is the immutable linkage key.
- No silent account merge just because emails match.
- Account-linking events audited.

## Decision

**Use Auth.js (next-auth v4) with a custom credentials provider and a Google
OIDC provider. Account linking requires authenticated proof of ownership.**

G01 scope (this ADR):
- `next-auth` is installed; `AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET` are in `.env.example` as scaffold.
- The Prisma schema models `User`, `AuthIdentity`, `EmailVerification` with
  the `(provider, providerSub)` unique constraint (invariant 1).
- No auth routes are live in G01. No session is created. No password is
  hashed. This is intentional — auth lands in G02.

G02 scope (future):
- Credentials provider with Argon2id password hashing.
- Email verification flow (signed token, 15-min expiry, single-use).
- Google OIDC provider with PKCE.
- Secure account-linking flow: a logged-in user who proves ownership of a
  Google account can link it; an anonymous Google login that collides with an
  existing email is NOT auto-linked.
- Session strategy: JWT (stateless) for v1; can move to database sessions
  later if revocation requirements demand it.

## Alternatives considered

1. **Lucia/Auth.js v5 beta.** Auth.js v4 is the stable line; v5 is still in
   beta. We pick stability for v1 and revisit at the v2 boundary.
2. **Custom session/JWT implementation.** Rejected — Auth.js handles session
   fixation, CSRF, cookie attributes, and provider flows correctly. Rebuilding
   these is exactly the "don't reinvent auth" the Playbook warns against.
3. **Email-as-identity for linking.** Rejected — violates invariant 1 and the
   STR-06 "no unsafe linking" rule. `sub` is the only safe linkage key.

## Consequences

- ✅ Standard, audited auth library; security updates tracked upstream.
- ✅ Schema already encodes the invariants; G02 implements against them.
- ⚠️ G01 honestly does NOT activate auth. Any claim that login works would be
  false. The home page renders for anonymous visitors only.
- ⚠️ Google OIDC requires a real `GOOGLE_CLIENT_ID`/`SECRET` and a configured
  redirect URI; these are founder-provisioned and land in G02.
