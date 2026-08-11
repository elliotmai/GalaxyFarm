import { getTableColumns } from "drizzle-orm";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  animalSchema,
  attachmentSchema,
  brandingConfigSchema,
  calendarEventSchema,
  choreTemplateSchema,
  contactSchema,
  feedingPlanSchema,
  pastureCareLogSchema,
  propertySchema,
  purchaseCandidateSchema,
  roadmapItemSchema,
  taskSchema,
  userSchema,
  waterSourceSchema,
  zoneAssignmentSchema,
  zoneSchema,
} from "@galaxy-farm/core";

import {
  breedingRecordSchema,
  calvingRecordSchema,
  cattleProfileSchema,
  externalAnimalSchema,
  weightRecordSchema,
} from "@galaxy-farm/module-cattle";

import { allTables } from "../src/schema/index.js";
import { REPOSITORY_TABLES } from "../src/sync/entities.js";

/**
 * The table and the schema describe the same record (spec §4.5 clause 2).
 *
 * `PostgresRepository` maps rows to entities by *column key*: for every key on
 * the drizzle table it reads the identically-named field off the record, and
 * vice versa. Nothing anywhere checked that those two sets of names matched,
 * and they did not — `roadmap_items` had a `budgetEstimateCents` column against
 * a `budgetEstimate` field, so a budget silently never reached the database,
 * and `purchase_candidates` had a NOT NULL `askingPriceCents` that no record
 * could ever populate, making the entity unsaveable outright.
 *
 * Both were invisible: the domain tests pass on pure objects, the conformance
 * suite runs against its own test table, and no screen had reached either
 * entity yet. A name-level check is the only thing that catches this class
 * before a screen does.
 */

/** Column key → field name is identity, so the two sets must match exactly. */
const SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
  properties: propertySchema,
  brandingConfigs: brandingConfigSchema,
  waterSources: waterSourceSchema,
  zones: zoneSchema,
  pastureCareLogs: pastureCareLogSchema,
  animals: animalSchema,
  cattleProfiles: cattleProfileSchema,
  externalAnimals: externalAnimalSchema,
  breedingRecords: breedingRecordSchema,
  calvingRecords: calvingRecordSchema,
  weightRecords: weightRecordSchema,
  zoneAssignments: zoneAssignmentSchema,
  feedingPlans: feedingPlanSchema,
  contacts: contactSchema,
  attachments: attachmentSchema,
  choreTemplates: choreTemplateSchema,
  tasks: taskSchema,
  calendarEvents: calendarEventSchema,
  roadmapItems: roadmapItemSchema,
  purchaseCandidates: purchaseCandidateSchema,
  users: userSchema,
};

/**
 * Columns a table carries that the entity deliberately does not.
 *
 * Short and justified on purpose — this is the one place the check is loosened.
 */
const SERVER_ONLY: Readonly<Record<string, readonly string[]>> = {
  // The hash never leaves the server and is not part of the domain type: §4.3
  // keeps credentials out of anything that syncs to a device.
  users: ["passwordHash"],
};

/**
 * Reach the object schema through any `.refine()` wrapper.
 *
 * Several entities carry cross-field invariants (§4.5 clause 2) which make the
 * runtime value a ZodEffects rather than a ZodObject. Unwrapping is the whole
 * reason this helper exists — reading `.shape` off the wrapper returns
 * undefined, and a check that silently sees no fields passes for every table.
 */
function shapeOf(schema: z.ZodTypeAny): Record<string, unknown> {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const shape = (current as { shape?: Record<string, unknown> }).shape;
    if (shape !== undefined) return shape;
    const inner = (current as { _def?: { schema?: z.ZodTypeAny } })._def?.schema;
    if (inner === undefined) break;
    current = inner;
  }
  throw new Error("Could not reach an object shape — is this schema still an object?");
}

describe("every table's columns match its entity's fields", () => {
  it("unwraps refined schemas rather than silently seeing no fields", () => {
    // Guards the guard: animalSchema is refined, so a broken `shapeOf` would
    // make every assertion below vacuous.
    expect(Object.keys(shapeOf(animalSchema))).toContain("species");
    expect(Object.keys(shapeOf(zoneSchema))).toContain("waterSourceIds");
  });

  it.each(Object.keys(SCHEMAS))("%s", (tableName) => {
    const table = allTables[tableName as keyof typeof allTables];
    expect(table, `${tableName} is not in allTables`).toBeDefined();

    const columns = Object.keys(getTableColumns(table));
    const fields = new Set(Object.keys(shapeOf(SCHEMAS[tableName] as z.ZodTypeAny)));
    const serverOnly = new Set(SERVER_ONLY[tableName] ?? []);

    const unreadable = columns.filter((key) => !fields.has(key) && !serverOnly.has(key));
    const unwritable = [...fields].filter((field) => !columns.includes(field));

    expect(
      unreadable,
      `${tableName} has columns no field maps to — the repository would write null`,
    ).toEqual([]);
    expect(
      unwritable,
      `${tableName} has fields with no column — the value would be dropped on save`,
    ).toEqual([]);
  });

  it("has a schema for every table a repository exists for", () => {
    // Otherwise a new table can be added, get a repository, and never be
    // checked against the entity it is supposed to store.
    const unchecked = REPOSITORY_TABLES.filter((name) => SCHEMAS[name] === undefined);

    expect(unchecked, "add these to SCHEMAS above").toEqual(["kioskDevices"]);
  });
});
