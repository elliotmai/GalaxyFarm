import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { freezeCheckTargets, type WaterSource, type Ulid } from "@galaxy-farm/core";

import type { Database } from "../src/repositories/postgres-repository.js";
import { animals, users, waterSources, zoneAssignments, zones } from "../src/schema/index.js";
import { SEED_ZONES, seed, seedId } from "../src/seed/index.js";

/**
 * Seeding the real farm (docs/property-layout.md).
 *
 * Two things are being checked. That the farm that lands in the database is
 * the farm that exists — nine zones, four tanks, none of them heated, one bred
 * cow — and that running it twice does not produce two farms. The second
 * matters more than it sounds: this will be run against a database that
 * already holds real records, and a seed that duplicates is a seed nobody
 * dares run a second time.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");
const NOW = new Date("2026-08-11T12:00:00Z");
const LATER = new Date("2026-09-01T12:00:00Z");

let client: PGlite;
let db: Database;

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
    "truncate table properties, zones, water_sources, animals, zone_assignments, users",
  );
});

describe("seed", () => {
  it("puts the farm that actually exists into the database", async () => {
    const summary = await seed(db, { now: NOW });

    expect(summary.zones).toBe(9);
    expect(summary.waterSources).toBe(4);
    expect(await db.select().from(zones)).toHaveLength(9);
    expect(await db.select().from(waterSources)).toHaveLength(4);
  });

  it("records that not one tank has a heater", async () => {
    // §6 names the heaterless tanks in the freeze alert. Here that is all of
    // them, and it lands in the same window as calving.
    await seed(db, { now: NOW });

    const tanks = await db.select().from(waterSources);
    expect(tanks.every((tank) => !tank.hasHeater)).toBe(true);
  });

  it("gives the auto-refill tanks covers and the static one none", async () => {
    // Covers are what this place does about a freeze, and the distinction is
    // the point: three tanks have something to put on before the cold, and the
    // West Pen's does not. Seeding all four with covers would send somebody out
    // to fit one that does not exist, which is how a chore list stops being
    // read.
    await seed(db, { now: NOW });

    const tanks = await db.select().from(waterSources);
    const auto = tanks.filter((tank) => tank.type === "auto_refill");
    const statics = tanks.filter((tank) => tank.type === "static_tank");

    expect(auto).toHaveLength(3);
    expect(auto.every((tank) => tank.cover === "off")).toBe(true);
    expect(statics.every((tank) => tank.cover === "none")).toBe(true);
  });

  it("shares tanks between zones instead of giving each one its own", async () => {
    // The modelling decision this whole entity exists for: four tanks serve
    // eight zones, one of them serving three. Per-zone water would fire eight
    // ice-breaking chores for four tanks.
    await seed(db, { now: NOW });

    const rows = await db.select().from(waterSources);
    const zoneRows = await db.select().from(zones);

    const sources: WaterSource[] = rows.map((row) => ({
      id: row.id as Ulid,
      propertyId: row.propertyId as Ulid,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      name: row.name,
      type: row.type as WaterSource["type"],
      hasHeater: row.hasHeater,
      cover: row.cover as WaterSource["cover"],
      active: row.active,
    }));

    const targets = freezeCheckTargets(
      sources,
      zoneRows.map((zone) => ({
        id: zone.id as Ulid,
        name: zone.name,
        waterSourceIds: zone.waterSourceIds as Ulid[],
        active: zone.active,
      })),
    );

    // Three chores, not eight: the West Pen's static tank is stowed.
    expect(targets).toHaveLength(3);
    const shared = targets.find((t) => t.waterSource.name.includes("Pen 1"));
    expect(shared?.zones.map((z) => z.name).sort()).toEqual([
      "2nd Pen",
      "Pen 1",
      "Randy's pasture",
    ]);
  });

  it("leaves the seasonal tank stowed, raising no chore", async () => {
    await seed(db, { now: NOW });

    const [west] = await db
      .select()
      .from(waterSources)
      .where(eq(waterSources.id, seedIdFor("water", "tank-west")));

    expect(west?.active).toBe(false);
  });

  it("types the tub as a working facility, not a pen", async () => {
    // Typing it as a pen would put it on the Pen Board as though something
    // lived there.
    await seed(db, { now: NOW });

    const rows = await db.select().from(zones);
    const tub = rows.find((zone) => zone.name.startsWith("Tub"));

    expect(tub?.type).toBe("working_facility");
  });

  it("puts Andromeda in the pasture, bred", async () => {
    await seed(db, { now: NOW });

    const [cow] = await db.select().from(animals);
    expect(cow?.name).toBe("Andromeda");
    expect(cow?.notes).toContain("ZNT Montego Bay");

    const assignments = await db.select().from(zoneAssignments);
    expect(assignments).toHaveLength(1);
    // Still open — the animal has not left.
    expect(assignments[0]?.periodTo).toBeNull();
  });

  it("is idempotent: two runs make one farm, not two", async () => {
    await seed(db, { now: NOW });
    await seed(db, { now: LATER });

    expect(await db.select().from(zones)).toHaveLength(9);
    expect(await db.select().from(waterSources)).toHaveLength(4);
    expect(await db.select().from(animals)).toHaveLength(1);
    expect(await db.select().from(zoneAssignments)).toHaveLength(1);
  });

  it("does not undo a change somebody made because the farm changed", async () => {
    // The seed knows the layout. It does not know whether the static tank is
    // out today, or whether a cow's status changed this morning.
    await seed(db, { now: NOW });
    await db
      .update(waterSources)
      .set({ active: true })
      .where(eq(waterSources.id, seedIdFor("water", "tank-west")));
    await db.update(animals).set({ status: "sold" });

    await seed(db, { now: LATER });

    const [west] = await db
      .select()
      .from(waterSources)
      .where(eq(waterSources.id, seedIdFor("water", "tank-west")));
    const [cow] = await db.select().from(animals);

    expect(west?.active).toBe(true);
    expect(cow?.status).toBe("sold");
  });

  it("creates the first owner when asked", async () => {
    const summary = await seed(db, {
      now: NOW,
      owner: { email: "Eli@Example.com", name: "Eli", passwordHash: "scrypt$1024$8$1$aGk$aGk" },
    });

    const [owner] = await db.select().from(users);
    expect(summary.ownerId).toBeDefined();
    // Lowercased: "Eli@" and "eli@" are one account.
    expect(owner?.email).toBe("eli@example.com");
    expect(owner?.role).toBe("owner");
  });

  it("never resets a password on a re-run", async () => {
    // Somebody will change their password and then somebody will re-seed.
    await seed(db, {
      now: NOW,
      owner: { email: "eli@example.com", name: "Eli", passwordHash: "scrypt$original" },
    });
    await db.update(users).set({ passwordHash: "scrypt$changed-since" });

    await seed(db, {
      now: LATER,
      owner: { email: "eli@example.com", name: "Eli", passwordHash: "scrypt$original" },
    });

    const [owner] = await db.select().from(users);
    expect(owner?.passwordHash).toBe("scrypt$changed-since");
  });

  it("touches no user when no owner is asked for", async () => {
    await seed(db, { now: NOW });

    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("gives every zone the water the layout says it has", async () => {
    await seed(db, { now: NOW });
    const rows = await db.select().from(zones);

    for (const zone of SEED_ZONES) {
      const row = rows.find((r) => r.name === zone.name);
      expect(row?.waterSourceIds, zone.name).toHaveLength(zone.waterSourceKeys.length);
    }
  });
});

/** Mirrors the id derivation in the seed, so tests can look a record up. */
function seedIdFor(kind: string, key: string): string {
  let value = 2166136261;
  const text = `${kind}:${key}`;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return seedId(Math.abs(value) % 1_000_000);
}
