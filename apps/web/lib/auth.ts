import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { systemClock, type Actor } from "@galaxy-farm/core";
import { signIn as verifyCredentials } from "@galaxy-farm/infra-auth";

import { authConfig } from "@/lib/auth.config";
import { credentialStore } from "@/lib/credential-store";

/**
 * Auth.js, over our own users table (spec §4.3).
 *
 * This file loads only in the Node runtime — the credentials provider hashes
 * with scrypt. The middleware uses `auth.config.ts`, which carries the same
 * callbacks and no providers.
 *
 * JWT sessions rather than database sessions. A credentials provider cannot
 * use database sessions anyway, and stateless is the right shape here: every
 * read comes from the device's local store (§4.2), so a session lookup per
 * request would add a Neon round trip to pages that otherwise touch the
 * database not at all.
 *
 * The token carries only what a capability check needs — id, role, property,
 * access window. Not the name, not the email, and certainly not the hash: a
 * JWT is signed, not secret, and whoever holds the cookie can read it.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = typeof raw?.["email"] === "string" ? raw["email"] : "";
        const password = typeof raw?.["password"] === "string" ? raw["password"] : "";
        if (email === "" || password === "") return null;

        const result = await verifyCredentials(
          credentialStore(),
          { email, password },
          systemClock(),
        );

        // Null for every failure, so the responses stay indistinguishable all
        // the way out to the browser — the property `signIn` went to some
        // trouble to establish.
        if (!result.ok) return null;

        return {
          id: result.actor.id,
          name: result.user.name,
          email: result.user.email,
          role: result.actor.role,
          propertyId: result.actor.propertyId,
          accessFrom: result.actor.accessWindow?.from.toISOString() ?? null,
          accessTo: result.actor.accessWindow?.to.toISOString() ?? null,
        } as never;
      },
    }),
  ],
});

/**
 * The actor for the current request, or undefined when nobody is signed in.
 *
 * Route handlers take the property from here and never from the payload —
 * which is what stops one property writing into another (§4.2).
 */
export async function currentActor(): Promise<Actor | undefined> {
  const session = await auth();
  return session?.actor;
}
