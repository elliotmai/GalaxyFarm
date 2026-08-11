import { NextResponse } from "next/server";

import {
  censusGeocoder,
  firstMatch,
  hardinessZone,
  nominatimGeocoder,
} from "@galaxy-farm/infra-geocoding";

import { currentActor } from "@/lib/auth";

/**
 * /api/geocode — an address in, a place out (spec §5.1).
 *
 * Server-side, like the forecast: the geocoders' usage policies are written
 * about a server making a handful of requests, not about every phone on the
 * property making its own, and Nominatim's in particular asks for an
 * identifying User-Agent that a browser will not let us set.
 *
 * Nothing is saved here. The route answers with what it found and the screen
 * shows it for confirmation before anything is written — a rural route matched
 * to the wrong side of a county line gives a wrong forecast that looks entirely
 * plausible, and the normalised address is the only thing that gives it away.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let address: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    address = typeof body["address"] === "string" ? body["address"] : "";
  } catch {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  if (address.trim() === "") {
    return NextResponse.json({ error: "Give me an address to look up" }, { status: 400 });
  }

  try {
    const geocoder = firstMatch(censusGeocoder(), nominatimGeocoder());
    const match = await geocoder.geocode({ address });

    if (match === undefined) {
      // 200, not 404. The request was fine and the answer is "no such
      // address"; a 404 here would read to the client as a broken route.
      return NextResponse.json({
        found: false,
        message: "No match for that address. Check the spelling, or enter the coordinates by hand.",
      });
    }

    // A nicety, and fail-soft by construction: an address that would not save
    // because a hardiness mirror was down would be worse than a blank zone.
    const hardiness =
      match.postalCode === undefined ? undefined : await hardinessZone(match.postalCode);

    return NextResponse.json({
      found: true,
      ...match,
      ...(hardiness === undefined ? {} : { growingZone: hardiness.zone, hardiness }),
    });
  } catch (error) {
    console.error("Geocoding failed", error);
    // Distinct from "no match", because the two call for different things
    // from the person at the screen: try again later, versus fix the address.
    return NextResponse.json(
      {
        found: false,
        message: "Could not reach the geocoder. Try again, or enter the coordinates by hand.",
      },
      { status: 503 },
    );
  }
}
