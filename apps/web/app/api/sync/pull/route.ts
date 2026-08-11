import { NextResponse } from "next/server";

/**
 * /api/sync/pull — not implemented yet. Returning 501 keeps the contract honest:
 * a caller gets an explicit "not built" rather than a silent 404 that looks
 * like a routing bug.
 */
export function GET() {
  return NextResponse.json({ error: "Not implemented", route: "/api/sync/pull" }, { status: 501 });
}

export function POST() {
  return NextResponse.json({ error: "Not implemented", route: "/api/sync/pull" }, { status: 501 });
}
