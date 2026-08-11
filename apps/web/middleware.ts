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

  const actor = request.auth?.actor;

  if (actor === undefined) {
    // Carry where they were going, so signing in lands them there rather than
    // on a dashboard they then navigate away from.
    const login = new URL("/login", request.nextUrl);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
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
