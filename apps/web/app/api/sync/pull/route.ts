import { NextResponse } from "next/server";

import type { Ulid } from "@galaxy-farm/core";
import { pullSince, syncedEntities } from "@galaxy-farm/infra-db";

import { syncErrorResponse } from "@/lib/api-errors";
import { currentActor } from "@/lib/auth";
import { database } from "@/lib/credential-store";
import { isDeviceLive } from "@/lib/device-store";
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

  // A revoked screen has to stop pulling within one sync interval, not merely
  // fail to sign in again whenever its JWT next expires — sessions here are
  // stateless (spec §4.3), so this is the live check that makes "revoke a
  // kiosk device" (§4.5) actually take effect promptly rather than eventually.
  if (actor.role === "kiosk") {
    const live =
      actor.deviceId !== undefined &&
      (await isDeviceLive(actor.deviceId as Ulid, actor.propertyId));
    if (!live)
      return NextResponse.json({ error: "This screen has been unpaired" }, { status: 401 });
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

  try {
    const pages = await pullSince(database(), {
      propertyId: actor.propertyId,
      cursors: body.cursors,
      // An unrecognised entity is skipped rather than refused, so a device on
      // an older build still syncs everything else it knows about.
      entities: body.entities ?? syncedEntities(),
    });

    return NextResponse.json({ pages });
  } catch (error) {
    // Never a bare 500. A device whose sync is failing keeps working from its
    // local store, so nobody finds out unless the response says so.
    return syncErrorResponse(error, "pull");
  }
}
