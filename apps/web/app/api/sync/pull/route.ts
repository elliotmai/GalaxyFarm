import { NextResponse } from "next/server";

import { pullSince, syncedEntities } from "@galaxy-farm/infra-db";

import { currentActor } from "@/lib/auth";
import { database } from "@/lib/credential-store";
import { reviveCursors } from "@/lib/sync-payload";

/**
 * /api/sync/pull — everything changed since the device's cursor (spec §4.2).
 *
 * Scoped to the session's property, tombstones included. A deletion travels as
 * a record: one that simply stopped appearing would live on forever on the
 * device that missed the pull.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // A customer's device holds only their own animals, which is a different
  // query than "everything on the property" — until /account is built, they
  // get nothing rather than everything.
  if (actor.role === "customer") {
    return NextResponse.json({ pages: [] });
  }

  let body: { cursors: ReturnType<typeof reviveCursors>; entities?: readonly string[] };
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = {
      cursors: reviveCursors(raw["cursors"]),
      ...(Array.isArray(raw["entities"]) ? { entities: raw["entities"] as string[] } : {}),
    };
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Malformed payload" },
      { status: 400 },
    );
  }

  const pages = await pullSince(database(), {
    propertyId: actor.propertyId,
    cursors: body.cursors,
    // An unrecognised entity is skipped rather than refused, so a device on an
    // older build still syncs everything else it knows about.
    entities: body.entities ?? syncedEntities(),
  });

  return NextResponse.json({ pages });
}
