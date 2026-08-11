import { sql } from "drizzle-orm";

import type { Ulid } from "@galaxy-farm/core";

import type { Database } from "../repositories/postgres-repository.js";
import {
  animals,
  properties,
  users,
  waterSources,
  zoneAssignments,
  zones,
} from "../schema/index.js";
import { SEED_ANIMALS, SEED_PROPERTY, SEED_WATER_SOURCES, SEED_ZONES, seedId } from "./farm.js";

/**
 * Put the real farm in the database (docs/property-layout.md).
 *
 * Idempotent: ids are derived rather than generated, so running it twice
 * updates the same rows instead of creating a second farm. That matters
 * because this will be run against a database that already has real records
 * in it, and a seed that duplicates is a seed nobody dares run.
 *
 * It writes only what it owns. Anything else in these tables is left alone.
 */

export interface SeedOptions {
  readonly now: Date;
  /** Set to create the first owner. Omitted, no user is touched. */
  readonly owner?: {
    readonly email: string;
    readonly name: string;
    readonly passwordHash: string;
  };
}

export interface SeedSummary {
  readonly propertyId: Ulid;
  readonly zones: number;
  readonly waterSources: number;
  readonly animals: number;
  readonly ownerId?: Ulid;
}

const PROPERTY_ID = seedId(0);

/** Stable ids per seeded record, so a re-run is an upsert. */
const idFor = (kind: string, key: string): Ulid => seedId(hash(`${kind}:${key}`) % 1_000_000);

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

export async function seed(db: Database, options: SeedOptions): Promise<SeedSummary> {
  const { now } = options;
  const base = { propertyId: PROPERTY_ID, createdAt: now, updatedAt: now };

  await db
    .insert(properties)
    .values({ id: PROPERTY_ID, ...base, ...SEED_PROPERTY })
    .onConflictDoUpdate({
      target: properties.id,
      set: {
        name: SEED_PROPERTY.name,
        address: SEED_PROPERTY.address,
        timezone: SEED_PROPERTY.timezone,
        growingZone: SEED_PROPERTY.growingZone,
        updatedAt: now,
      },
    });

  const waterIds = new Map<string, Ulid>();
  for (const source of SEED_WATER_SOURCES) {
    const id = idFor("water", source.key);
    waterIds.set(source.key, id);
    await db
      .insert(waterSources)
      .values({
        id,
        ...base,
        name: source.name,
        type: source.type,
        hasHeater: source.hasHeater,
        active: source.active,
        notes: source.notes ?? null,
      })
      .onConflictDoUpdate({
        target: waterSources.id,
        // Deliberately narrow: `active` is not overwritten, because whether
        // the seasonal tank is currently out is a fact about today that
        // somebody set in the app, not something a seed file knows.
        set: { name: source.name, type: source.type, hasHeater: source.hasHeater, updatedAt: now },
      });
  }

  const zoneIds = new Map<string, Ulid>();
  for (const zone of SEED_ZONES) {
    const id = idFor("zone", zone.key);
    zoneIds.set(zone.key, id);
    await db
      .insert(zones)
      .values({
        id,
        ...base,
        name: zone.name,
        type: zone.type,
        indoor: zone.indoor,
        baselineSafetyLevel: zone.baselineSafetyLevel,
        waterSourceIds: zone.waterSourceKeys.map((key) => waterIds.get(key)!),
        customInstructions: zone.customInstructions ?? null,
        resting: zone.resting,
        active: true,
      })
      .onConflictDoUpdate({
        target: zones.id,
        set: {
          name: zone.name,
          type: zone.type,
          waterSourceIds: zone.waterSourceKeys.map((key) => waterIds.get(key)!),
          updatedAt: now,
        },
      });
  }

  for (const animal of SEED_ANIMALS) {
    const id = idFor("animal", animal.key);
    await db
      .insert(animals)
      .values({
        id,
        ...base,
        species: animal.species,
        name: animal.name,
        sex: animal.sex,
        dobIsEstimate: animal.dobIsEstimate,
        status: animal.status,
        ownership: animal.ownership,
        safetyLevel: animal.safetyLevel,
        notes: animal.notes,
      })
      .onConflictDoUpdate({
        target: animals.id,
        // Identity, not state. Species, sex and ownership are what the animal
        // *is* — a seeded cow does not become somebody else's — so the seed
        // may assert them, and asserting them is how a bad value written by an
        // earlier version of this file gets corrected. Status, safety level
        // and the rest are facts about today that somebody set in the app, and
        // a re-run must not undo those.
        set: {
          name: animal.name,
          species: animal.species,
          sex: animal.sex,
          ownership: animal.ownership,
          updatedAt: now,
        },
      });

    await db
      .insert(zoneAssignments)
      .values({
        id: idFor("assignment", animal.key),
        ...base,
        animalId: id,
        zoneId: zoneIds.get(animal.zoneKey)!,
        periodFrom: now,
        slot: animal.slot,
      })
      .onConflictDoNothing({ target: zoneAssignments.id });
  }

  let ownerId: Ulid | undefined;
  if (options.owner !== undefined) {
    ownerId = idFor("user", options.owner.email);
    await db
      .insert(users)
      .values({
        id: ownerId,
        ...base,
        email: options.owner.email.toLowerCase(),
        name: options.owner.name,
        role: "owner",
        passwordHash: options.owner.passwordHash,
        active: true,
      })
      // The password is not overwritten on a re-run. Seeding again must not
      // silently reset a password somebody has since changed.
      .onConflictDoUpdate({
        target: users.email,
        set: { name: options.owner.name, updatedAt: now },
      });
  }

  return {
    propertyId: PROPERTY_ID,
    zones: SEED_ZONES.length,
    waterSources: SEED_WATER_SOURCES.length,
    animals: SEED_ANIMALS.length,
    ...(ownerId === undefined ? {} : { ownerId }),
  };
}

/** How many rows the seed owns, for a summary line and for tests. */
export async function seededCounts(db: Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries({ zones, waterSources, animals })) {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`${table.propertyId} = ${PROPERTY_ID}`);
    counts[name] = rows[0]?.total ?? 0;
  }
  return counts;
}

export { PROPERTY_ID as SEED_PROPERTY_ID };
