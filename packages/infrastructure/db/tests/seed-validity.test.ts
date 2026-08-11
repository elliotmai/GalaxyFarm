import { describe, expect, it } from "vitest";

import {
  animalSchema,
  waterSourceSchema,
  zoneSchema,
  zoneAssignmentSchema,
  type Ulid,
} from "@galaxy-farm/core";

import { SEED_ANIMALS, SEED_WATER_SOURCES, SEED_ZONES, seedId } from "../src/seed/index.js";

/**
 * The seed, parsed by the schemas the app uses (spec §4.5 clause 2).
 *
 * The database columns are `text`, deliberately — the schema of record for
 * what is valid is the Zod schema in the kernel, not a Postgres constraint
 * (§5). Which means the seed can write a value no form would ever accept, and
 * nothing complains until somebody opens the record and the edit fails to
 * validate.
 *
 * That is not hypothetical: this file was written after the seed put
 * `ownership: "owned"` on Andromeda, where the enum is `own | client`. It went
 * into a real database and would have surfaced as "cannot save" the first time
 * anybody edited her.
 */

const PROPERTY = seedId(0);
const AT = new Date("2026-08-11T12:00:00Z");
const base = (id: Ulid) => ({ id, propertyId: PROPERTY, createdAt: AT, updatedAt: AT });

/** Report what failed, not just that something did. */
function issuesOf(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("the seeded farm is valid by the app's own rules", () => {
  it("every water source parses", () => {
    for (const source of SEED_WATER_SOURCES) {
      const result = waterSourceSchema.safeParse({
        ...base(seedId(1)),
        name: source.name,
        type: source.type,
        hasHeater: source.hasHeater,
        active: source.active,
        ...(source.notes === undefined ? {} : { notes: source.notes }),
      });

      expect(issuesOf(result), source.name).toEqual([]);
    }
  });

  it("every zone parses", () => {
    for (const zone of SEED_ZONES) {
      const result = zoneSchema.safeParse({
        ...base(seedId(2)),
        name: zone.name,
        type: zone.type,
        indoor: zone.indoor,
        baselineSafetyLevel: zone.baselineSafetyLevel,
        waterSourceIds: zone.waterSourceKeys.map(() => seedId(3)),
        ...(zone.customInstructions === undefined
          ? {}
          : { customInstructions: zone.customInstructions }),
        resting: zone.resting,
        active: true,
      });

      expect(issuesOf(result), zone.name).toEqual([]);
    }
  });

  it("every animal parses", () => {
    // The one that failed. `ownership: "owned"` is not a member of the enum,
    // and a text column has no opinion about that.
    for (const animal of SEED_ANIMALS) {
      const result = animalSchema.safeParse({
        ...base(seedId(4)),
        species: animal.species,
        name: animal.name,
        sex: animal.sex,
        dobIsEstimate: animal.dobIsEstimate,
        status: animal.status,
        ownership: animal.ownership,
        safetyLevel: animal.safetyLevel,
        photoKeys: [],
        notes: animal.notes,
      });

      expect(issuesOf(result), animal.name).toEqual([]);
    }
  });

  it("every animal is placed in a zone that exists", () => {
    // A dangling zone key would seed an assignment pointing at nothing, and
    // the Pen Board would quietly show the animal nowhere.
    const zoneKeys = new Set(SEED_ZONES.map((zone) => zone.key));

    for (const animal of SEED_ANIMALS) {
      expect(zoneKeys.has(animal.zoneKey), `${animal.name} → ${animal.zoneKey}`).toBe(true);
    }
  });

  it("every zone drinks from a water source that exists", () => {
    const waterKeys = new Set(SEED_WATER_SOURCES.map((source) => source.key));

    for (const zone of SEED_ZONES) {
      for (const key of zone.waterSourceKeys) {
        expect(waterKeys.has(key), `${zone.name} → ${key}`).toBe(true);
      }
    }
  });

  it("places each animal in a real slot, with an open period", () => {
    // The slot is read from the seed rather than written out here. Assuming a
    // value is how the first version of this test passed while the seed was
    // writing `slot: "resident"`, which is not a member of the enum — a text
    // column has no opinion, and neither did a test that did not look.
    for (const animal of SEED_ANIMALS) {
      const result = zoneAssignmentSchema.safeParse({
        ...base(seedId(5)),
        animalId: seedId(4),
        zoneId: seedId(2),
        periodFrom: AT,
        slot: animal.slot,
      });

      expect(issuesOf(result), animal.name).toEqual([]);
    }
  });
});
