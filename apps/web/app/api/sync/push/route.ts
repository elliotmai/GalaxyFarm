import { NextResponse } from "next/server";

import {
  canWriteEntity,
  capabilityToWrite,
  encodeUlid,
  systemClock,
  type OutboxEntry,
  type PushRejection,
} from "@galaxy-farm/core";
import { applyPush } from "@galaxy-farm/infra-db";

import { syncErrorResponse } from "@/lib/api-errors";
import { currentActor } from "@/lib/auth";
import { database } from "@/lib/credential-store";
import { reviveOutboxEntries } from "@/lib/sync-payload";

/**
 * /api/sync/push — a device's queued work, applied and merged (spec §4.2).
 *
 * The property comes from the session and never from the payload. A device may
 * only write into the property it is signed in to, and `propertyId` is a
 * reserved patch field precisely so a body cannot argue otherwise.
 *
 * **Capability is checked per entity, here.** Being allowed to sync is not the
 * same as being allowed to write everything a device holds: this is a POST
 * endpoint, and §4.3 is explicit that hiding the screen that would have
 * produced a patch prevents nobody from posting one. Most entities need
 * `records.write`, which every member has; a few need their own capability,
 * and `ENTITY_WRITE_CAPABILITY` in the kernel is the list.
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

  // Refused rather than dropped, and refused *before* anything is merged. The
  // device's outbox counts a rejection against the entry and sets it aside
  // after a few, which is what puts it in the sync panel's stuck count instead
  // of retrying a write that will never be allowed until the day somebody's
  // role changes. The reason names the capability, because the ordinary cause
  // of this is a role that changed after the work was queued, not an attack.
  const now = new Date();
  const permitted: OutboxEntry[] = [];
  const refused: PushRejection[] = [];

  for (const entry of entries) {
    if (canWriteEntity(actor, entry.patch.entity, now)) {
      permitted.push(entry);
    } else {
      refused.push({
        id: entry.id,
        reason: `Writing ${entry.patch.entity} needs ${capabilityToWrite(entry.patch.entity)}, which this account does not have.`,
      });
    }
  }

  try {
    const result = await applyPush(database(), permitted, {
      propertyId: actor.propertyId,
      clock: systemClock(),
      ids: { next: () => encodeUlid(Date.now()) },
    });

    return NextResponse.json({ ...result, rejected: [...refused, ...result.rejected] });
  } catch (error) {
    // A push that fails silently is the expensive one: the outbox keeps the
    // work, but nobody is told it is not leaving the device.
    return syncErrorResponse(error, "push");
  }
}
