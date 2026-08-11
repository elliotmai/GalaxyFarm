import type { NextAuthConfig } from "next-auth";

import type { Actor, Role, Ulid } from "@galaxy-farm/core";

/**
 * The half of the Auth.js configuration that can run anywhere.
 *
 * Middleware runs on the Edge runtime, which has no `node:crypto` — and the
 * credentials provider hashes with scrypt, which is exactly that. Importing
 * the full configuration into the middleware fails the build with an
 * unhandled-scheme error that says nothing about why.
 *
 * So the providers live in `auth.ts`, which only ever loads in Node, and
 * everything the middleware actually needs — reading a role off an
 * already-signed token — lives here. The middleware never verifies a password;
 * it only asks who the cookie says you are.
 */

declare module "next-auth" {
  interface Session {
    actor: Actor;
  }
}

export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Auth.js refuses to trust the Host header unless it is told to, and off
  // Vercel that refusal surfaces as an opaque `UntrustedHost` on the first
  // request the browser makes. This app is always served from a host we
  // control — Netlify now, a box in the barn later — so the header is the
  // right source for the callback URL.
  trustHost: true,
  // Filled in by `auth.ts`. Empty here is what keeps this file edge-safe.
  providers: [],

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
} satisfies NextAuthConfig;
