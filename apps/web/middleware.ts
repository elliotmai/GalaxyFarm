import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth.config";
import { homeSurfaceFor, mayReachSurface, surfaceOf } from "@/lib/surface-access";

/**
 * Surface routing (spec §4.3).
 *
 * A gate on which app you can load, not on what you may do inside it. The
 * second question is answered by capabilities in the application layer, where
 * §4.3 puts it — a route somebody cannot reach is no substitute for a record
 * they cannot touch, and treating it as one puts the permission model in the
 * router.
 *
 * Built from `authConfig` rather than from `auth.ts`: middleware runs on the
 * Edge runtime, and the credentials provider needs `node:crypto`. Reading a
 * role off an already-signed token needs neither.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const surface = surfaceOf(request.nextUrl.pathname);
  if (surface === undefined) return NextResponse.next();

  // The one page inside a gated surface a signed-out visitor has to reach:
  // pairing a fresh screen *is* how it gets a session, so gating the page
  // that grants one would be a lock with the key on the wrong side of it
  // (spec §4.4). Nothing here is sensitive — it is a form and a code that
  // expires in `PAIRING_TTL_MINUTES` either way.
  if (request.nextUrl.pathname === "/kiosk/pair") return NextResponse.next();

  const actor = request.auth?.actor;

  if (actor === undefined) {
    // A barn screen is never sent to `/login`. There is no account behind it
    // and nobody standing at it: a login form on a wall-mounted tablet is a
    // dead end that costs somebody a walk out with a fresh pairing code. It
    // goes to `/kiosk/pair` instead, which signs it straight back in from the
    // device token it holds (spec §4.4) and only asks for a code if that
    // token is genuinely no good any more.
    const destination = surface === "kiosk" ? "/kiosk/pair" : "/login";

    // Carry where they were going, so getting a session lands them there
    // rather than on a dashboard they then navigate away from.
    const away = new URL(destination, request.nextUrl);
    away.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(away);
  }

  if (!mayReachSurface(actor.role, surface)) {
    // Their own surface rather than a 403. Someone following a stale bookmark
    // is not doing anything wrong and has nothing to fix.
    return NextResponse.redirect(new URL(homeSurfaceFor(actor.role), request.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/account/:path*", "/sitter/:path*", "/kiosk/:path*"],
};
