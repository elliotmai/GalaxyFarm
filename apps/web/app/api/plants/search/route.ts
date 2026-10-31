import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth";
import { searchPlants } from "@/lib/plant-search";

/**
 * /api/plants/search?q= — plant names for the crop and variety forms (§5.5).
 *
 * Session-checked and server-side for the same reasons as the geocoder: the
 * answers are cached once for everybody rather than per phone, and the browser
 * never talks to GBIF itself. See `lib/plant-search.ts` for the sources.
 *
 * Always 200 for a signed-in request with a query. GBIF being down is
 * `online: false` with the built-in answers, which the form shows as a quiet
 * line rather than an error — the crop can still be typed by hand.
 */

export const dynamic = "force-dynamic";

/** Shorter than this and GBIF answers with half the plant kingdom. */
const MIN_QUERY = 2;
const MAX_QUERY = 80;

export async function GET(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < MIN_QUERY) {
    return NextResponse.json({ results: [], online: true });
  }

  return NextResponse.json(await searchPlants(q), {
    // Per person, briefly: typing the same word twice should not ask again.
    headers: { "cache-control": "private, max-age=3600" },
  });
}
