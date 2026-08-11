import { NextResponse } from "next/server";

/**
 * Role-based surface routing (spec §4.3) attaches here: `/admin` and `/kiosk`
 * for owner/member/kiosk, `/account` for customers, `/sitter` for time-boxed
 * housesitter sessions. Until Auth.js is wired the middleware is a pass-through.
 */
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*", "/sitter/:path*", "/kiosk/:path*"],
};
