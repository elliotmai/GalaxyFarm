import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { encode } from "next-auth/jwt";

/**
 * Signed-in sessions for the e2e suite (spec §4.3).
 *
 * Every admin, account and sitter route is behind the middleware, so a suite
 * with no session tests exactly one thing on every page: that it redirects to
 * `/login`. That is worth asserting once and useless as the whole suite —
 * which is what it had quietly become.
 *
 * The session is **minted**, not signed in for. Auth.js is on JWT sessions
 * (`session: { strategy: "jwt" }`), so a session is a signed cookie and
 * nothing else — no row, no lookup, no database. That is the property this
 * relies on, and it is the same property that lets the app read every page
 * from IndexedDB without a round trip. Driving the login form instead would
 * put a Postgres, a seeded user and a scrypt hash in front of a suite whose
 * job is to check that pages render.
 *
 * The token shape is not invented here: it mirrors exactly what
 * `authConfig.callbacks.jwt` puts on the token, so `session()` builds the same
 * `Actor` it would after a real sign-in. A field added there and forgotten
 * here would give the suite a session the app never issues.
 */

/** Matches Auth.js's own default over plain http. Also the encryption salt. */
export const SESSION_COOKIE = "authjs.session-token";

/**
 * The secret the app is served with.
 *
 * Falls back only so a developer can run the suite without a `.env.local`; CI
 * sets it explicitly on both the runner and the server under test. A mismatch
 * produces a cookie the app decrypts to nothing, which looks exactly like
 * being signed out — so it is worth knowing that is the failure mode.
 */
export const E2E_AUTH_SECRET = process.env["AUTH_SECRET"] ?? "e2e-secret-not-for-production";

/**
 * The role names are the app's own, from `ROLES` in the kernel.
 *
 * Not a parallel vocabulary: "sitter" is the *surface*, `housesitter` is the
 * role, and minting a cookie that says "sitter" produces an actor whose role
 * matches nothing in `SURFACE_ROLES` — so the middleware bounces it to a home
 * surface that does not exist and the page 404s. Which is exactly what
 * happened, and is the reason this type is written out rather than inferred
 * from the surface names.
 */
export type E2ERole = "owner" | "customer" | "housesitter";

/** ULIDs are 26 characters of Crockford base32; these are valid and fixed. */
const ACTORS: Readonly<Record<E2ERole, { id: string; propertyId: string }>> = {
  owner: { id: "01HQ0000000000000000000001", propertyId: "01HQ00000000000000000000P0" },
  customer: { id: "01HQ0000000000000000000002", propertyId: "01HQ00000000000000000000P0" },
  housesitter: { id: "01HQ0000000000000000000003", propertyId: "01HQ00000000000000000000P0" },
};

export async function sessionCookieFor(role: E2ERole): Promise<string> {
  const actor = ACTORS[role];

  return encode({
    secret: E2E_AUTH_SECRET,
    salt: SESSION_COOKIE,
    token: {
      sub: actor.id,
      role,
      propertyId: actor.propertyId,
    },
    // Long enough that a slow CI run cannot expire mid-suite.
    maxAge: 60 * 60,
  });
}

export function storageStatePath(role: E2ERole): string {
  return join(process.cwd(), "test-results", ".auth", `${role}.json`);
}

/**
 * Write one role's storage state to disk for Playwright to load.
 *
 * `127.0.0.1` rather than `localhost`: the base URL uses the numeric form, and
 * a cookie scoped to the other name is simply never sent — a failure that
 * presents as "signed out" with nothing in any log to say why. No port: cookies
 * are scoped by host, not by port, so one file serves whichever port the
 * server came up on.
 */
export async function writeStorageState(role: E2ERole): Promise<void> {
  const path = storageStatePath(role);
  mkdirSync(dirname(path), { recursive: true });

  writeFileSync(
    path,
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE,
          value: await sessionCookieFor(role),
          domain: "127.0.0.1",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax" as const,
        },
      ],
      origins: [],
    }),
    "utf8",
  );
}
