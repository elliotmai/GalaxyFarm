import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor, Animal, Ulid, Zone, ZoneAssignment } from "@galaxy-farm/core";
import { kioskDevices, repositoryFor, type Database } from "@galaxy-farm/infra-db";
import type { EggLog } from "@galaxy-farm/module-poultry";

import { logEggsForKiosk, moveAnimalForKiosk } from "../lib/kiosk-store.js";

/**
 * What a kiosk's browser may write, against real Postgres (spec §4.3, §4.4).
 *
 * The write path goes through `applyPush` rather than a plain insert, so the
 * property that matters is whether the row that lands is the one Postgres
 * actually merged — not whether a mock was called with the right arguments.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ69G5G${String(n).padStart(2, "0")}` as Ulid;

let client: PGlite;
let db: Database;

const base = (recordId: Ulid, propertyId: Ulid = PROPERTY) => ({
  id: recordId,
  propertyId,
  createdAt: NOW,
  updatedAt: NOW,
});

const kioskActor = (overrides: Partial<Actor> = {}): Actor => ({
  id: id(90),
  role: "kiosk",
  propertyId: PROPERTY,
  deviceId: id(90),
  ...overrides,
});

const saveZone = (recordId: Ulid, overrides: Partial<Zone> = {}) =>
  repositoryFor<Zone>(db, "zones").save({
    ...base(recordId),
    name: "North Trap",
    type: "pasture",
    indoor: false,
    baselineSafetyLevel: 1,
    waterSourceIds: [],
    resting: false,
    active: true,
    ...overrides,
  } as Zone);

const saveAnimal = (recordId: Ulid, overrides: Partial<Animal> = {}) =>
  repositoryFor<Animal>(db, "animals").save({
    ...base(recordId),
    species: "cattle",
    name: "Dolly",
    sex: "female",
    dobIsEstimate: false,
    status: "active",
    ownership: "own",
    safetyLevel: 1,
    photoKeys: [],
    ...overrides,
  } as Animal);

/** A live, paired kiosk device row — the row every real `kiosk`-role Actor corresponds to. */
const pairDevice = (recordId: Ulid, propertyId: Ulid = PROPERTY) =>
  db.insert(kioskDevices).values({
    id: recordId,
    propertyId,
    createdAt: NOW,
    updatedAt: NOW,
    name: "Barn TV",
    tokenHash: "test-hash",
    pairingCode: null,
    pairingExpiresAt: null,
    pairedAt: NOW,
  });

const saveAssignment = (recordId: Ulid, overrides: Partial<ZoneAssignment>) =>
  repositoryFor<ZoneAssignment>(db, "zoneAssignments").save({
    ...base(recordId),
    animalId: id(1),
    zoneId: id(2),
    periodFrom: NOW,
    slot: "outside",
    ...overrides,
  } as ZoneAssignment);

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec(
    "truncate table zones, animals, zone_assignments, egg_logs, kiosk_devices, sync_field_meta, sync_audit",
  );
  // Every `kioskActor()` below carries this id — a real `kiosk`-role Actor
  // only ever exists because `authenticateDevice` found a live row for it, so
  // the write paths' own liveness check (`assertLiveDevice`) expects one too.
  await pairDevice(id(90));
});

describe("logEggsForKiosk", () => {
  it("writes a fresh log, attributed to the device", async () => {
    const outcome = await logEggsForKiosk(
      kioskActor(),
      { breakdown: [{ colour: "brown", size: "large", count: 1 }] },
      NOW,
      db,
    );

    expect(outcome.ok).toBe(true);

    const logs = await repositoryFor<EggLog>(db, "eggLogs").list({ propertyId: PROPERTY });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.total).toBe(1);
    expect(logs[0]?.breakdown).toEqual([{ colour: "brown", size: "large", count: 1 }]);
  });

  it("logs a bare count of one when no breakdown is given — the 'Other' button", async () => {
    const outcome = await logEggsForKiosk(kioskActor(), {}, NOW, db);
    expect(outcome.ok).toBe(true);

    const logs = await repositoryFor<EggLog>(db, "eggLogs").list({ propertyId: PROPERTY });
    expect(logs[0]?.total).toBe(1);
    expect(logs[0]?.breakdown).toEqual([]);
  });

  it("two taps write two independent rows, not a read-modify-write of one", async () => {
    await logEggsForKiosk(kioskActor(), {}, NOW, db);
    await logEggsForKiosk(kioskActor(), {}, new Date(NOW.getTime() + 1000), db);

    const logs = await repositoryFor<EggLog>(db, "eggLogs").list({ propertyId: PROPERTY });
    expect(logs).toHaveLength(2);
  });

  it("refuses an actor without eggs.log — a housesitter, say", async () => {
    const outcome = await logEggsForKiosk(kioskActor({ role: "housesitter" }), {}, NOW, db);

    expect(outcome.ok).toBe(false);
    const logs = await repositoryFor<EggLog>(db, "eggLogs").list({ propertyId: PROPERTY });
    expect(logs).toHaveLength(0);
  });

  it("attributes an owner or member using /kiosk themselves, who has no deviceId", async () => {
    const outcome = await logEggsForKiosk(
      { id: id(91), role: "owner", propertyId: PROPERTY },
      {},
      NOW,
      db,
    );
    expect(outcome.ok).toBe(true);
  });
});

describe("moveAnimalForKiosk", () => {
  it("closes the open assignment and opens a new one in the target zone", async () => {
    await saveZone(id(2), { name: "North Trap" });
    await saveZone(id(3), { name: "South Trap" });
    await saveAnimal(id(1));
    await saveAssignment(id(4), { animalId: id(1), zoneId: id(2), periodFrom: NOW });

    const outcome = await moveAnimalForKiosk(
      kioskActor(),
      { animalId: id(1), zoneId: id(3) },
      new Date(NOW.getTime() + 60_000),
      db,
    );

    expect(outcome.ok).toBe(true);

    const assignments = await repositoryFor<ZoneAssignment>(db, "zoneAssignments").list({
      propertyId: PROPERTY,
    });
    const closed = assignments.find((a) => a.id === id(4));
    const opened = assignments.find((a) => a.id !== id(4));

    expect(closed?.periodTo).toBeDefined();
    expect(opened?.zoneId).toBe(id(3));
    expect(opened?.periodTo).toBeUndefined();
  });

  it("refuses when the animal has nowhere it is currently assigned", async () => {
    await saveZone(id(2));
    await saveAnimal(id(1));

    const outcome = await moveAnimalForKiosk(
      kioskActor(),
      { animalId: id(1), zoneId: id(2) },
      NOW,
      db,
    );

    expect(outcome.ok).toBe(false);
  });

  it("refuses a zone from another property", async () => {
    await saveZone(id(2), { propertyId: OTHER_PROPERTY });
    await saveAnimal(id(1));
    await saveAssignment(id(4), { animalId: id(1), zoneId: id(3), periodFrom: NOW });

    const outcome = await moveAnimalForKiosk(
      kioskActor(),
      { animalId: id(1), zoneId: id(2) },
      NOW,
      db,
    );

    expect(outcome.ok).toBe(false);
  });

  it("refuses an actor without animals.move", async () => {
    await saveZone(id(2));
    await saveAnimal(id(1));
    await saveAssignment(id(4), { animalId: id(1), zoneId: id(3), periodFrom: NOW });

    const outcome = await moveAnimalForKiosk(
      kioskActor({ role: "customer" }),
      { animalId: id(1), zoneId: id(2) },
      NOW,
      db,
    );

    expect(outcome.ok).toBe(false);
  });
});
