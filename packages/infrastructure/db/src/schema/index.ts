import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Extensionless on purpose: drizzle-kit loads this file through a CommonJS
// bundler that does not resolve the ".js" specifier the rest of the
// workspace uses. `moduleResolution: "Bundler"` accepts both.
import { baseColumns, baseIndexes } from "./columns";

/**
 * The Postgres schema (spec §5).
 *
 * Plain Postgres, no extensions, no provider-specific types — that is what
 * makes §10's move to a box in the barn a `pg_dump | pg_restore` rather than a
 * rewrite. Drizzle generates ordinary SQL that any Postgres 14+ will accept.
 *
 * Two conventions worth stating once:
 *
 * - **Enums are `text`, not Postgres `enum` types.** Adding a value to a
 *   Postgres enum is a migration with a lock; adding one to a Zod union is a
 *   deploy. The schema of record for what is valid is the Zod schema in the
 *   kernel (§4.5 clause 2), and duplicating it here as a database constraint
 *   would give two sources of truth that drift.
 * - **Arrays are columns, not join tables.** The sync engine patches *fields*
 *   (§4.2). `water_source_ids` as a `text[]` is one field and syncs naturally;
 *   the same relationship as a join table has no representation in a
 *   field-level patch at all.
 */

export const properties = pgTable(
  "properties",
  {
    ...baseColumns,
    name: text("name").notNull(),
    address: text("address"),
    timezone: text("timezone").notNull(),
    growingZone: text("growing_zone"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    offlineImageryKey: text("offline_imagery_key"),
  },
  baseIndexes("properties"),
);

export const brandingConfigs = pgTable(
  "branding_configs",
  {
    ...baseColumns,
    farmName: text("farm_name").notNull(),
    businessName: text("business_name"),
    tagline: text("tagline"),
    logoKey: text("logo_key"),
  },
  baseIndexes("branding_configs"),
);

export const waterSources = pgTable(
  "water_sources",
  {
    ...baseColumns,
    name: text("name").notNull(),
    type: text("type").notNull(),
    hasHeater: boolean("has_heater").notNull(),
    /** False while a seasonal tank is stowed — raises no freeze chore (§6). */
    active: boolean("active").notNull(),
    notes: text("notes"),
  },
  baseIndexes("water_sources"),
);

export const zones = pgTable(
  "zones",
  {
    ...baseColumns,
    name: text("name").notNull(),
    type: text("type").notNull(),
    indoor: boolean("indoor").notNull(),
    capacity: integer("capacity"),
    /** Real lat/lng, so pens render over Google or cached NAIP alike (§8). */
    boundary: jsonb("boundary").$type<{ lat: number; lng: number }[]>(),
    baselineSafetyLevel: integer("baseline_safety_level").notNull(),
    waterSourceIds: text("water_source_ids").array().notNull().default([]),
    customInstructions: text("custom_instructions"),
    resting: boolean("resting").notNull(),
    active: boolean("active").notNull(),
  },
  baseIndexes("zones"),
);

export const animals = pgTable(
  "animals",
  {
    ...baseColumns,
    species: text("species").notNull(),
    name: text("name"),
    tagNumber: text("tag_number"),
    sex: text("sex").notNull(),
    dob: timestamp("dob", { withTimezone: true, mode: "date" }),
    dobIsEstimate: boolean("dob_is_estimate").notNull(),
    status: text("status").notNull(),
    ownership: text("ownership").notNull(),
    ownerId: text("owner_id"),
    safetyLevel: integer("safety_level").notNull(),
    safetyNotes: text("safety_notes"),
    photoKeys: text("photo_keys").array().notNull().default([]),
    customInstructions: text("custom_instructions"),
    notes: text("notes"),
  },
  baseIndexes("animals"),
);

export const zoneAssignments = pgTable(
  "zone_assignments",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    zoneId: text("zone_id").notNull(),
    /** The open assignment is the current one; history is never overwritten. */
    periodFrom: timestamp("period_from", { withTimezone: true, mode: "date" }).notNull(),
    periodTo: timestamp("period_to", { withTimezone: true, mode: "date" }),
    slot: text("slot").notNull(),
  },
  baseIndexes("zone_assignments"),
);

export const contacts = pgTable(
  "contacts",
  {
    ...baseColumns,
    name: text("name").notNull(),
    company: text("company"),
    tags: text("tags").array().notNull().default([]),
    phones: jsonb("phones").$type<{ label: string; number: string }[]>().notNull().default([]),
    emails: jsonb("emails").$type<{ label: string; address: string }[]>().notNull().default([]),
    address: text("address"),
    notes: text("notes"),
  },
  baseIndexes("contacts"),
);

export const attachments = pgTable(
  "attachments",
  {
    ...baseColumns,
    ownerEntity: text("owner_entity").notNull(),
    ownerId: text("owner_id").notNull(),
    key: text("key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    caption: text("caption"),
    /** False until the upload reaches R2; the record exists first (§4.2). */
    uploaded: boolean("uploaded").notNull(),
  },
  baseIndexes("attachments"),
);

export const choreTemplates = pgTable(
  "chore_templates",
  {
    ...baseColumns,
    title: text("title").notNull(),
    detail: text("detail"),
    recurrence: text("recurrence").notNull(),
    recurrenceDays: integer("recurrence_days").array().notNull().default([]),
    zoneId: text("zone_id"),
    animalId: text("animal_id"),
    active: boolean("active").notNull(),
  },
  baseIndexes("chore_templates"),
);

export const tasks = pgTable(
  "tasks",
  {
    ...baseColumns,
    templateId: text("template_id"),
    title: text("title").notNull(),
    detail: text("detail"),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedBy: text("completed_by"),
    assignedTo: text("assigned_to"),
    zoneId: text("zone_id"),
    animalId: text("animal_id"),
  },
  baseIndexes("tasks"),
);

export const roadmapItems = pgTable(
  "roadmap_items",
  {
    ...baseColumns,
    domain: text("domain").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    targetDate: timestamp("target_date", { withTimezone: true, mode: "date" }),
    targetSeason: text("target_season"),
    priority: text("priority").notNull(),
    /** Whole cents. Floating-point dollars drift; per-animal P&L cannot. */
    budgetEstimateCents: integer("budget_estimate_cents"),
    status: text("status").notNull(),
  },
  baseIndexes("roadmap_items"),
);

export const purchaseCandidates = pgTable(
  "purchase_candidates",
  {
    ...baseColumns,
    domain: text("domain").notNull(),
    roadmapItemId: text("roadmap_item_id"),
    title: text("title").notNull(),
    status: text("status").notNull(),
    askingPriceCents: integer("asking_price_cents").notNull(),
    /** Hauling, inspection, repairs — the costs that decide the purchase. */
    additionalCosts: jsonb("additional_costs")
      .$type<{ label: string; amount: { cents: number } }[]>()
      .notNull()
      .default([]),
    listingUrl: text("listing_url"),
    sellerId: text("seller_id"),
    location: text("location"),
    distanceMiles: integer("distance_miles"),
    listedDate: timestamp("listed_date", { withTimezone: true, mode: "date" }),
    firstSeen: timestamp("first_seen", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    photoKeys: text("photo_keys").array().notNull().default([]),
    pros: text("pros").array().notNull().default([]),
    cons: text("cons").array().notNull().default([]),
    notes: text("notes"),
    planStatus: text("plan_status").notNull(),
    realisedAs: text("realised_as"),
    realisedAt: timestamp("realised_at", { withTimezone: true, mode: "date" }),
    abandonedReason: text("abandoned_reason"),
  },
  baseIndexes("purchase_candidates"),
);

/**
 * The sync audit — a field-level change log (§4.2, decision 23).
 *
 * Append-only and on the §4.5 exception list: create-and-read, never edited,
 * never deleted. Corrections happen by superseding entry.
 */
export const syncAudit = pgTable(
  "sync_audit",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    entity: text("entity").notNull(),
    recordId: text("record_id").notNull(),
    field: text("field").notNull(),
    winnerValue: jsonb("winner_value"),
    winnerAt: timestamp("winner_at", { withTimezone: true, mode: "date" }).notNull(),
    winnerDeviceId: text("winner_device_id").notNull(),
    loserValue: jsonb("loser_value"),
    loserAt: timestamp("loser_at", { withTimezone: true, mode: "date" }).notNull(),
    loserDeviceId: text("loser_device_id").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    // The query that matters: "what happened to this record's fields?"
    index().on(table.recordId),
    index().on(table.resolvedAt),
  ],
);

export const allTables = {
  properties,
  brandingConfigs,
  waterSources,
  zones,
  animals,
  zoneAssignments,
  contacts,
  attachments,
  choreTemplates,
  tasks,
  roadmapItems,
  purchaseCandidates,
  syncAudit,
};
