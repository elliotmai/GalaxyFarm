import { NextResponse } from "next/server";

import { currentActor } from "@/lib/auth";
import { weatherSnapshot } from "@/lib/weather-service";

/**
 * /api/weather — the forecast for the signed-in property (spec §6).
 *
 * The one network read a screen makes, and the only one. Everything else the
 * dashboard shows comes from the device's own store (§4.2), so this failing
 * costs the weather signals and nothing else — the calving watch still knows
 * what day of gestation every cow is at.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Always 200. `weatherSnapshot` never throws and reports its own trouble in
  // `unavailable`, which the card renders as a sentence. A 503 here would make
  // the client treat a missing forecast as a broken page.
  return NextResponse.json(await weatherSnapshot(actor.propertyId));
}
