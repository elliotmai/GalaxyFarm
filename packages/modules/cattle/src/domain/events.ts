import type { DomainEvent, Ulid } from "@galaxy-farm/core";

import { createEvent } from "@galaxy-farm/core";

import type { CalvingRecord } from "./calving-record.js";

/**
 * What cattle tells the rest of the app (spec §4.1).
 *
 * The rule that shapes this file: cattle must not import feed, and feed must
 * not import cattle. `boundaries.test.ts` fails the build on either. So the
 * calving flow cannot call "offer a creep plan" — it announces that a calving
 * happened, and whoever cares subscribes. `apps/web` is the only place the two
 * sides meet, which is also the only place §4.1 allows them to.
 *
 * The payload carries ids and the two facts a listener actually needs — that
 * the calf is alive and when it was born — rather than the whole record. A
 * listener that needed more can read it; a payload that grows to whatever the
 * newest listener wanted is how an event bus turns back into an import.
 */

export type CalvingRecordedEvent = DomainEvent<
  "CalvingRecorded",
  {
    readonly damId: Ulid;
    /** Absent for a stillbirth: no animal was created, so there is none to feed. */
    readonly calfAnimalId?: Ulid;
    readonly bornOn: Date;
    readonly liveCalf: boolean;
  }
>;

export const CALVING_RECORDED = "CalvingRecorded" as const;

export function calvingRecorded(
  record: Pick<CalvingRecord, "id" | "propertyId" | "damId" | "date" | "calfAnimalId">,
  options: { readonly liveCalf: boolean; readonly occurredAt?: Date },
): CalvingRecordedEvent {
  return createEvent(CALVING_RECORDED, {
    // The event happened when the calving was recorded, not when the calf was
    // born — those differ by however long it took somebody to get to a phone,
    // and a listener scheduling a follow-up wants the recording time.
    occurredAt: options.occurredAt ?? new Date(),
    propertyId: record.propertyId,
    aggregateId: record.id,
    payload: {
      damId: record.damId,
      ...(record.calfAnimalId === undefined ? {} : { calfAnimalId: record.calfAnimalId }),
      bornOn: record.date,
      liveCalf: options.liveCalf,
    },
  });
}
