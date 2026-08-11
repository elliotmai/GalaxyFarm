import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { systemClock, type Actor, type Role, type Ulid } from "@galaxy-farm/core";
import { signIn as verifyCredentials } from "@galaxy-farm/infra-auth";

import { credentialStore } from "@/lib/credential-store";

/**
 * Auth.js, over our own users table (spec §4.3).
 *
 * JWT sessions rather than database sessions. Credentials providers cannot use
 * database sessions anyway, and a stateless session is the right shape here:
 * every read in this app comes from the device's local store (§4.2), so a
 * session lookup on each request would add a Neon round trip to pages that
 * otherwise touch the database not at all.
 *
 * The token carries only what a capability check needs — id, role, property,
 * and the access window. Not the name, not the email, and certainly not the
 * hash: a JWT is signed, not encrypted at rest in the browser, and everything
 * put in one is readable by whoever holds the cookie.
 */

declare module "next-auth" {
  interface Session {
    actor: Actor;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },

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

        // Returning null for every failure keeps the responses
        // indistinguishable all the way out to the browser, which is the
        // property `signIn` went to some trouble to establish.
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

  callbacks: {
    jwt({ token, user }) {
      // `user` is set only on the sign-in pass; afterwards the token is
      // whatever was already there.
      if (user !== undefined) {
        const source = user as unknown as Record<string, unknown>;
        token["role"] = source["role"];
        token["propertyId"] = source["propertyId"];
        token["accessFrom"] = source["accessFrom"];
        token["accessTo"] = source["accessTo"];
      }
      return token;
    },

    session({ session, token }) {
      const from = token["accessFrom"];
      const to = token["accessTo"];

      session.actor = {
        id: token.sub as Ulid,
        role: token["role"] as Role,
        propertyId: token["propertyId"] as Ulid,
        ...(typeof from === "string" && typeof to === "string"
          ? { accessWindow: { from: new Date(from), to: new Date(to) } }
          : {}),
      };
      return session;
    },
  },
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
