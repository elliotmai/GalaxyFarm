import { NextResponse } from "next/server";

import { encodeUlid, systemClock, type OutboxEntry } from "@galaxy-farm/core";
import { applyPush } from "@galaxy-farm/infra-db";

import { currentActor } from "@/lib/auth";
import { database } from "@/lib/credential-store";
import { reviveOutboxEntries } from "@/lib/sync-payload";

/**
 * /api/sync/push — a device's queued work, applied and merged (spec §4.2).
 *
 * The property comes from the session and never from the payload. A device may
 * only write into the property it is signed in to, and `propertyId` is a
 * reserved patch field precisely so a body cannot argue otherwise.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await currentActor();
  if (actor === undefined) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // §4.3: kiosks and housesitters do not push. Their whitelisted actions go
  // through use cases that check their own capability, not through a general
  // write channel.
  if (actor.role !== "owner" && actor.role !== "member") {
    return NextResponse.json({ error: "Not permitted to sync" }, { status: 403 });
  }

  let entries: readonly OutboxEntry[];
  try {
    entries = reviveOutboxEntries(await request.json());
  } catch (error) {
    // A malformed body is the client's problem to fix, not something to retry.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Malformed payload" },
      { status: 400 },
    );
  }

  const result = await applyPush(database(), entries, {
    propertyId: actor.propertyId,
    clock: systemClock(),
    ids: { next: () => encodeUlid(Date.now()) },
  });

  return NextResponse.json(result);
}
