import {
  can,
  diff,
  encodeUlid,
  moveToZone,
  openAssignments,
  systemClock,
  type Actor,
  type FieldValue,
  type Ulid,
  type Zone,
  type ZoneAssignment,
} from "@galaxy-farm/core";
import { applyPush, repositoryFor, type Database } from "@galaxy-farm/infra-db";
import type { EggBreakdown, EggLog } from "@galaxy-farm/module-poultry";

import { database } from "@/lib/credential-store";
import { isDeviceLive } from "@/lib/device-store";

/**
 * What a kiosk's browser is allowed to write (spec §4.4, §4.3).
 *
 * The same reasoning as `sitter-store.ts`: `/kiosk` runs the full local store
 * (unlike `/sitter`, a kiosk holds everything `records.read` can see) but its
 * writes cannot go through the ordinary outbox — `/api/sync/push` refuses
 * anything that is not `owner` or `member` outright (spec §4.3's whitelist is
 * enforced there, not by hiding the button). So the three whitelisted actions
 * — `chores.complete`, `eggs.log`, `animals.move` — each get a narrow
 * server-side function that checks its own capability and writes through
 * `applyPush` directly, the same door `tickChore` already uses for a
 * housesitter. Chores reuse `tickChore` itself; this file holds the other two.
 *
 * Every write is attributed to the *device*, not to whoever is standing there.
 * Nobody signs a name at a barn screen, and the audit log would be guessing if
 * it pretended otherwise — `deviceId` on the `Actor` is exactly what a paired
 * kiosk carries for this.
 */

export type KioskActionOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

function refused(reason: string): KioskActionOutcome {
  return { ok: false, reason };
}

/**
 * A revoked screen has to stop writing as promptly as it stops pulling.
 * `can()` only reads the role on a stateless JWT (spec §4.3) and knows
 * nothing about a device row being revoked out from under a still-valid
 * session, so every write path here checks Postgres directly rather than
 * trusting the token. An owner or member acting on `/kiosk` as themselves has
 * no `deviceId` and skips this — there is no device row for them to revoke.
 */
async function assertLiveDevice(actor: Actor, db: Database): Promise<boolean> {
  if (actor.role !== "kiosk" || actor.deviceId === undefined) return true;
  return isDeviceLive(actor.deviceId as Ulid, actor.propertyId, db);
}

export interface LogEggsInput {
  readonly flockId?: Ulid | undefined;
  readonly zoneId?: Ulid | undefined;
  readonly breakdown?: readonly EggBreakdown[] | undefined;
}

/**
 * One tap of a kiosk's +1 button (spec §4.4, §5.4).
 *
 * Always a fresh row, never a read-modify-write of today's total. Two taps a
 * second apart — the ordinary case, someone collecting a basketful — are two
 * independent creates, so there is nothing to race and nothing for one tap to
 * clobber if the other is still in flight on a slow connection.
 */
export async function logEggsForKiosk(
  actor: Actor,
  input: LogEggsInput,
  at: Date,
  db: Database = database(),
): Promise<KioskActionOutcome> {
  if (!can(actor, "eggs.log", at)) return refused("This screen cannot log eggs.");
  if (!(await assertLiveDevice(actor, db))) return refused("This screen has been unpaired.");

  // A real paired screen gets its own id; an owner or member using `/kiosk` on
  // their own phone has none, and is attributed by their own id instead — the
  // same fallback `tickChore` uses for a housesitter with no device of theirs.
  const deviceId = actor.deviceId ?? `kiosk-surface:${actor.id}`;

  const breakdown = input.breakdown ?? [];
  const total = breakdown.reduce((sum, row) => sum + row.count, 0) || 1;
  const id = encodeUlid(at.getTime()) as Ulid;

  const fields: EggLog = {
    id,
    propertyId: actor.propertyId,
    createdAt: at,
    updatedAt: at,
    collectedOn: at,
    total,
    breakdown,
    ...(input.flockId === undefined ? {} : { flockId: input.flockId }),
    ...(input.zoneId === undefined ? {} : { zoneId: input.zoneId }),
  };

  return push(
    db,
    actor.propertyId,
    deviceId,
    "eggLogs",
    id,
    "create",
    {},
    fields as unknown as Record<string, FieldValue>,
  );
}

export interface MoveAnimalInput {
  readonly animalId: Ulid;
  readonly zoneId: Ulid;
}

/**
 * Moving an animal from the Pen Board (spec §4.4, §5.1).
 *
 * `moveToZone` is the one place both the herd screen and the Pen Board decide
 * what closes and what opens — reused here rather than restated, so a kiosk
 * move and an admin move can never disagree about the rule. Everything it
 * needs comes straight from Postgres: a kiosk write action is a single
 * request with no local store of its own reads to lean on the way the
 * client-side herd screen does.
 */
export async function moveAnimalForKiosk(
  actor: Actor,
  input: MoveAnimalInput,
  at: Date,
  db: Database = database(),
): Promise<KioskActionOutcome> {
  if (!can(actor, "animals.move", at)) return refused("This screen cannot move animals.");
  if (!(await assertLiveDevice(actor, db))) return refused("This screen has been unpaired.");
  const deviceId = actor.deviceId ?? `kiosk-surface:${actor.id}`;

  const zone = await repositoryFor<Zone>(db, "zones").findById(input.zoneId);
  if (zone === undefined || zone.propertyId !== actor.propertyId) {
    return refused("That pen is not on this property.");
  }

  const zones = await repositoryFor<Zone>(db, "zones").list({ propertyId: actor.propertyId });
  const indoorZoneIds = new Set(zones.filter((z) => z.indoor).map((z) => z.id));

  const assignments = await repositoryFor<ZoneAssignment>(db, "zoneAssignments").list({
    propertyId: actor.propertyId,
  });
  if (openAssignments(assignments, input.animalId).length === 0) {
    return refused("That animal has no current location to move from.");
  }

  const { closed, opened } = moveToZone(
    assignments,
    {
      id: encodeUlid(at.getTime()) as Ulid,
      propertyId: actor.propertyId,
      createdAt: at,
      updatedAt: at,
      animalId: input.animalId,
      zoneId: input.zoneId,
      indoor: zone.indoor,
      at,
    },
    indoorZoneIds,
  );

  const meta = { at, deviceId };
  const ids = { next: () => encodeUlid(at.getTime()) };
  const entries = [
    ...closed.map((assignment) => ({
      id: ids.next(),
      operation: "update" as const,
      patch: {
        entity: "zoneAssignments",
        recordId: assignment.id,
        changes: diff({}, { periodTo: assignment.periodTo } as Record<string, FieldValue>, meta),
      },
      queuedAt: at,
      deviceId,
      attempts: 0,
    })),
    // Absent when she is already standing in the target zone — the whole
    // move is a no-op past whatever `closed` repaired, and writing a second
    // identical assignment is exactly the fault `moveToZone` now refuses to
    // produce.
    ...(opened === undefined
      ? []
      : [
          {
            id: ids.next(),
            operation: "create" as const,
            patch: {
              entity: "zoneAssignments",
              recordId: opened.id,
              changes: diff(
                {},
                {
                  animalId: opened.animalId,
                  zoneId: opened.zoneId,
                  slot: opened.slot,
                  periodFrom: opened.periodFrom,
                } as Record<string, FieldValue>,
                meta,
              ),
            },
            queuedAt: at,
            deviceId,
            attempts: 0,
          },
        ]),
  ];

  if (entries.length === 0) return { ok: true };

  const result = await applyPush(db, entries, {
    propertyId: actor.propertyId,
    clock: systemClock(),
    ids,
  });

  return result.rejected.length === 0
    ? { ok: true }
    : refused(result.rejected[0]?.reason ?? "The farm refused that move.");
}

/** One create, through the same door `tickChore` and `applyPush` share. */
async function push(
  db: Database,
  propertyId: Ulid,
  deviceId: string,
  entity: string,
  recordId: Ulid,
  operation: "create" | "update",
  before: Record<string, FieldValue>,
  after: Record<string, FieldValue>,
): Promise<KioskActionOutcome> {
  const at = new Date();
  const ids = { next: () => encodeUlid(at.getTime()) };

  const result = await applyPush(
    db,
    [
      {
        id: ids.next(),
        operation,
        patch: { entity, recordId, changes: diff(before, after, { at, deviceId }) },
        queuedAt: at,
        deviceId,
        attempts: 0,
      },
    ],
    { propertyId, clock: systemClock(), ids },
  );

  return result.rejected.length === 0
    ? { ok: true }
    : refused(result.rejected[0]?.reason ?? "The farm refused that change.");
}
