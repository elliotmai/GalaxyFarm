import { NextResponse } from "next/server";

/**
 * /api/sync/push — 501 until auth lands (#7).
 *
 * The handler behind this route is built and tested: `applyPush` in
 * `@galaxy-farm/infra-db`. What is missing is a session. Both sync handlers
 * take the property from the authenticated caller rather than from the
 * payload, which is what stops one property writing into another — publish
 * this route before there is a session to read and it becomes an open write
 * endpoint into the farm's database.
 *
 * 501 rather than 404, so a caller gets an explicit "not built" instead of
 * something that looks like a routing bug.
 */
export function GET() {
  return NextResponse.json({ error: "Not implemented", route: "/api/sync/push" }, { status: 501 });
}

export function POST() {
  return NextResponse.json({ error: "Not implemented", route: "/api/sync/push" }, { status: 501 });
}
