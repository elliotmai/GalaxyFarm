import { diff, encodeUlid, systemClock, type FieldValue, type Ulid } from "@galaxy-farm/core";
import { applyPush, repositoryFor } from "@galaxy-farm/infra-db";
import type { Trip } from "@galaxy-farm/module-housesitting";

import { database } from "@/lib/credential-store";
import { tripFieldsFrom, type TripFields, type WanderTravel } from "@/lib/wander-client";

/**
 * Writing a pulled trip onto the farm's records (spec §5.10, §4.2).
 *
 * Through `applyPush`, the same door a kiosk's writes go through, rather than
 * straight at the repository. That is what puts a pulled trip in the sync
 * audit, moves the sync cursor, and gets it to every device — a row written
 * around the push path is a row a barn screen never hears about, which on this
 * feature is the entire point of the exercise.
 *
 * **Matched on `externalId`, never on name or dates.** Wander is the identity
 * here: rename a trip there, move its dates, and it is still the same trip, so
 * a second pull has to update the row it wrote last time rather than leave a
 * duplicate behind. `trips_external_idx` enforces the same thing in the
 * database.
 */

/** Attribution for the audit log. Not a device — nothing paired did this. */
const CONNECTOR = "wander-connector";

/**
 * `Trip` as a bag of fields the patch layer can diff.
 *
 * `legs` goes through as one value rather than a nested structure, which is
 * what makes a leg list a field-level patch (§4.2) — the same reason it is one
 * jsonb column rather than a child table.
 */
function asFields(fields: TripFields): Record<string, FieldValue> {
  return {
    name: fields.name,
    destination: fields.destination ?? null,
    startDate: fields.startDate,
    endDate: fields.endDate,
    whoIsAway: fields.whoIsAway,
    reachableAt: fields.reachableAt ?? null,
    notes: fields.notes ?? null,
    legs: fields.legs,
    source: fields.source,
    externalId: fields.externalId ?? null,
  } as unknown as Record<string, FieldValue>;
}

export interface WrittenTrip {
  readonly id: Ulid;
  readonly name: string;
  readonly legs: readonly unknown[];
  /** True when this pull created the row rather than refreshing it. */
  readonly created: boolean;
}

export async function upsertTripFromWander(
  propertyId: Ulid,
  wanderTripId: string,
  travel: WanderTravel,
): Promise<WrittenTrip> {
  const db = await database();
  const at = new Date();
  const ids = { next: () => encodeUlid(at.getTime()) };

  const held = await repositoryFor<Trip>(db, "trips").list({ propertyId });
  const existing = held.find(
    (trip) => trip.externalId === wanderTripId && trip.deletedAt === undefined,
  );

  // A trip the owner has already deleted here is deliberately not resurrected:
  // deleting it is how somebody says "stop showing this", and a pull that
  // undid that would be unwinnable — they would delete it again every hour.
  // A new row is written instead only when none was ever written.
  const deletedBefore = held.some(
    (trip) => trip.externalId === wanderTripId && trip.deletedAt !== undefined,
  );
  if (existing === undefined && deletedBefore) {
    const tombstoned = held.find((trip) => trip.externalId === wanderTripId);
    return {
      id: tombstoned?.id ?? (ids.next() as Ulid),
      name: travel.name,
      legs: [],
      created: false,
    };
  }

  const fields = tripFieldsFrom(travel, wanderTripId, existing?.whoIsAway);
  const after = asFields(fields);
  const before: Record<string, FieldValue> =
    existing === undefined
      ? ({} as Record<string, FieldValue>)
      : asFields({
          name: existing.name,
          ...(existing.destination === undefined ? {} : { destination: existing.destination }),
          startDate: existing.startDate,
          endDate: existing.endDate,
          whoIsAway: existing.whoIsAway,
          ...(existing.reachableAt === undefined ? {} : { reachableAt: existing.reachableAt }),
          ...(existing.notes === undefined ? {} : { notes: existing.notes }),
          legs: existing.legs,
          source: existing.source,
          ...(existing.externalId === undefined ? {} : { externalId: existing.externalId }),
        });

  const recordId = existing?.id ?? (ids.next() as Ulid);

  const result = await applyPush(
    db,
    [
      {
        id: ids.next(),
        operation: existing === undefined ? "create" : "update",
        patch: {
          entity: "trips",
          recordId,
          changes: diff(before, after, { at, deviceId: CONNECTOR }),
        },
        queuedAt: at,
        deviceId: CONNECTOR,
        attempts: 0,
      },
    ],
    { propertyId, clock: systemClock(), ids },
  );

  const refusal = result.rejected[0]?.reason;
  if (refusal !== undefined) throw new Error(refusal);

  return {
    id: recordId,
    name: fields.name,
    legs: fields.legs,
    created: existing === undefined,
  };
}
