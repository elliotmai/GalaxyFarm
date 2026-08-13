import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
 * - **A column key is the entity's field name, exactly.** The repository maps
 *   the two by identity, so `budget_estimate_cents` against a `budgetEstimate`
 *   field is not a naming preference — it is a value that never arrives.
 *   `tests/schema-conformance.test.ts` fails the build on any mismatch.
 *
 * Money is `jsonb` holding the domain's `{ cents }` rather than an integer
 * column, for that last reason: `Money` is an object, and the alternative is a
 * per-field codec on every one of the forty-odd money fields §5 asks for —
 * forty chances to forget one. Whole cents either way, so nothing drifts; a
 * report that wants to aggregate reads `(col->>'cents')::int`.
 */

export const properties = pgTable(
  "properties",
  {
    ...baseColumns,
    name: text("name").notNull(),
    address: text("address"),
    timezone: text("timezone").notNull(),
    growingZone: text("growing_zone"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    offlineImageryKey: text("offline_imagery_key"),
    /** Per-property renaming of the five safety levels (§5.1). */
    safetyLevelLabels: jsonb("safety_level_labels").$type<Record<string, string>>(),
    /** §6 thresholds, per-trigger opt-out and lead time. Merged over defaults. */
    watchSettings: jsonb("watch_settings").$type<Record<string, unknown>>(),
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

/**
 * Land upkeep per zone (§5.1, added v0.7).
 *
 * A log rather than fields on `zones`, because "when did we last overseed" is
 * the question the fall reminder is built on and that is a history.
 */
export const pastureCareLogs = pgTable(
  "pasture_care_logs",
  {
    ...baseColumns,
    zoneId: text("zone_id").notNull(),
    action: text("action").notNull(),
    performedOn: timestamp("performed_on", { withTimezone: true, mode: "date" }).notNull(),
    product: text("product"),
    ratePerAcre: jsonb("rate_per_acre").$type<{ amount: number; unit: string }>(),
    acres: doublePrecision("acres"),
    cost: jsonb("cost").$type<{ cents: number }>(),
    /** The supplies-module stock this drew from (§5.11). */
    supplyItemId: text("supply_item_id"),
    notes: text("notes"),
  },
  baseIndexes("pasture_care_logs"),
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
    diedOn: timestamp("died_on", { withTimezone: true, mode: "date" }),
    causeOfDeath: text("cause_of_death"),
    notes: text("notes"),
  },
  baseIndexes("animals"),
);

/**
 * The papers (spec §5.2).
 *
 * A sidecar on `animals` rather than more columns on it, because §2 keeps one
 * Animal model across species and a chicken has no breed percentages or
 * association number. Registrations are an array: §5.2 says an animal can be
 * papered in several associations at once, which is ordinary for show cattle.
 */
export const cattleProfiles = pgTable(
  "cattle_profiles",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    /** What breed it is, in words. A list — a crossbred animal is more than one. */
    breed: jsonb("breed").$type<string[]>(),
    breedComposition: jsonb("breed_composition")
      .$type<{ breed: string; percent: number }[]>()
      .notNull()
      .default([]),
    hornStatus: text("horn_status"),
    colour: text("colour"),
    markings: text("markings"),
    /** Hair-card results — TH, PHA, DS and the rest (§5.2). */
    geneticTests: jsonb("genetic_tests")
      .$type<
        {
          defect: string;
          status: string;
          testedOn?: string;
          lab?: string;
          notes?: string;
        }[]
      >()
      .notNull()
      .default([]),
    /** Extension and roan alleles, for predicting a calf's colour. */
    coatGenotype: jsonb("coat_genotype").$type<{
      extension?: [string, string];
      roan?: [string, string];
    }>(),
    registrations: jsonb("registrations")
      .$type<
        {
          association: string;
          regNumber: string;
          registeredName?: string;
          tattoo?: string;
          epdSnapshot?: Record<string, number>;
          epdCapturedOn?: string;
        }[]
      >()
      .notNull()
      .default([]),
    /** Sire and dam resolve to an on-farm animal or an ExternalAnimal (§5.2). */
    sire: jsonb("sire").$type<{ kind: string; id: string }>(),
    dam: jsonb("dam").$type<{ kind: string; id: string }>(),
  },
  baseIndexes("cattle_profiles"),
);

/**
 * Ancestors that are not ours (spec §5.2).
 *
 * A five-generation tree has thirty ancestors and this farm will own two of
 * them. Requiring the rest to be Animals would mean thirty records with no
 * location, no health, and no reason to exist.
 */
export const externalAnimals = pgTable(
  "external_animals",
  {
    ...baseColumns,
    name: text("name").notNull(),
    regNumber: text("reg_number"),
    association: text("association"),
    /**
     * Every registry this animal is recorded in.
     *
     * One animal, several numbers: a bull registered with both Maine-Anjou and
     * Chianina has a different number in each, and his dam's Chianina pedigree
     * prints her Chianina number while his Maine-Anjou pedigree prints her
     * Maine-Anjou one. `regNumber` alone made those two pages import the same
     * cow twice, with each copy holding half her descendants.
     */
    registrations: jsonb("registrations").$type<{ association: string; regNumber: string }[]>(),
    tattoo: text("tattoo"),
    sex: text("sex"),
    dob: timestamp("dob", { withTimezone: true }),
    colour: text("colour"),
    hornStatus: text("horn_status"),
    /** The class the papers state — `PB`, `FB`, `3/4`. Kept as printed. */
    classification: text("classification"),
    breed: jsonb("breed").$type<string[]>(),
    breedComposition: jsonb("breed_composition").$type<{ breed: string; percent: number }[]>(),
    /** The association's own inbreeding figure, not the one computed here. */
    coi: doublePrecision("coi"),
    status: text("status"),
    disposedOn: timestamp("disposed_on", { withTimezone: true }),
    serviceType: text("service_type"),
    sourceUrl: text("source_url"),
    geneticTests: jsonb("genetic_tests").$type<{ defect: string; status: string }[]>(),
    sire: jsonb("sire").$type<{ kind: string; id: string }>(),
    dam: jsonb("dam").$type<{ kind: string; id: string }>(),
    notes: text("notes"),
  },
  baseIndexes("external_animals"),
);

/**
 * Breeding, and every date that falls out of it (spec §5.2).
 *
 * `date` and `gestationDays` are the only things anybody types. The due date,
 * the calving window, the preg-check reminder and the watch card are all
 * derived from them (§2), so correcting a breeding date moves everything
 * downstream rather than leaving a stale copy behind.
 */
export const breedingRecords = pgTable(
  "breeding_records",
  {
    ...baseColumns,
    damId: text("dam_id").notNull(),
    method: text("method").notNull(),
    bullId: text("bull_id"),
    semenInventoryId: text("semen_inventory_id"),
    sireExternalId: text("sire_external_id"),
    embryoDonorId: text("embryo_donor_id"),
    embryoCode: text("embryo_code"),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    technicianId: text("technician_id"),
    syncProtocolId: text("sync_protocol_id"),
    pregCheck: jsonb("preg_check").$type<{
      date: string;
      result: string;
      method: string;
      notes?: string;
    }>(),
    /** Overrides the property default; §12 decision 2 makes it configurable. */
    gestationDays: integer("gestation_days"),
    notes: text("notes"),
  },
  baseIndexes("breeding_records"),
);

/**
 * Calving (§5.2).
 *
 * `calf_animal_id` is what stops the flow producing twins. Recording a calving
 * creates the calf, and a device that syncs the calving before the animal — or
 * a person who taps save twice on a slow phone — would otherwise create a
 * second one. With the id on the record, the second run has nothing to do.
 */
export const calvingRecords = pgTable(
  "calving_records",
  {
    ...baseColumns,
    damId: text("dam_id").notNull(),
    /** The breeding this answers, so the sire resolves without being asked. */
    breedingRecordId: text("breeding_record_id"),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    calvingEase: integer("calving_ease").notNull(),
    /** Natural, pulled, or a C-section — the plain fact under the 1–5 score. */
    birthType: text("birth_type").notNull().default("natural"),
    premature: boolean("premature"),
    vigour: text("vigour").notNull(),
    calfSex: text("calf_sex"),
    birthWeightLb: doublePrecision("birth_weight_lb"),
    assisted: boolean("assisted").notNull(),
    assistDetail: text("assist_detail"),
    calfAnimalId: text("calf_animal_id"),
    notes: text("notes"),
  },
  baseIndexes("calving_records"),
);

/**
 * Weights (§5.2).
 *
 * A birth weight is a WeightRecord in the `birth` context rather than a field
 * on the calving record, so the growth chart, the ADG and the 205-day figure
 * all read one series instead of special-casing the first point.
 */
export const weightRecords = pgTable(
  "weight_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    weightLb: doublePrecision("weight_lb").notNull(),
    context: text("context").notNull(),
    notes: text("notes"),
  },
  baseIndexes("weight_records"),
);

/**
 * Treatments, and the clock they start (§5.2).
 *
 * `withdrawalDays` is copied from the product at the time of treatment rather
 * than read through to the inventory record. A label change next year must not
 * silently move a clearance date somebody has already sold an animal against.
 */
export const healthRecords = pgTable(
  "health_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    type: text("type").notNull(),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    product: text("product"),
    medInventoryId: text("med_inventory_id"),
    dose: jsonb("dose").$type<{ amount: number; unit: string }>(),
    route: text("route"),
    administeredBy: text("administered_by"),
    vetContactId: text("vet_contact_id"),
    cost: jsonb("cost").$type<{ cents: number }>(),
    withdrawalDays: integer("withdrawal_days"),
    boosterDueOn: timestamp("booster_due_on", { withTimezone: true, mode: "date" }),
    notes: text("notes"),
  },
  baseIndexes("health_records"),
);

/** Standing heats, which is what the next breeding window is built on (§5.2). */
export const heatRecords = pgTable(
  "heat_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull(),
    intensity: text("intensity").notNull(),
    observedBy: text("observed_by"),
    notes: text("notes"),
  },
  baseIndexes("heat_records"),
);

/** What is in the medicine fridge (§5.2). */
export const medInventory = pgTable(
  "med_inventory",
  {
    ...baseColumns,
    product: text("product").notNull(),
    category: text("category").notNull(),
    onHand: jsonb("on_hand").$type<{ amount: number; unit: string }>().notNull(),
    expiresOn: timestamp("expires_on", { withTimezone: true, mode: "date" }),
    lotNumber: text("lot_number"),
    unitCost: jsonb("unit_cost").$type<{ cents: number }>(),
    defaultWithdrawalDays: integer("default_withdrawal_days"),
    storageLocation: text("storage_location"),
    vendorContactId: text("vendor_contact_id"),
    notes: text("notes"),
  },
  baseIndexes("med_inventory"),
);

/** What is in the tank (§5.2). */
export const semenInventory = pgTable(
  "semen_inventory",
  {
    ...baseColumns,
    sireExternalId: text("sire_external_id"),
    sireAnimalId: text("sire_animal_id"),
    sireName: text("sire_name").notNull(),
    strawsOnHand: integer("straws_on_hand").notNull(),
    tank: text("tank"),
    canister: text("canister"),
    cane: text("cane"),
    source: text("source"),
    vendorContactId: text("vendor_contact_id"),
    pricePerStraw: jsonb("price_per_straw").$type<{ cents: number }>(),
    purchasedOn: timestamp("purchased_on", { withTimezone: true, mode: "date" }),
    reorderThreshold: integer("reorder_threshold"),
    notes: text("notes"),
  },
  baseIndexes("semen_inventory"),
);

/** Oestrus synchronisation protocols, as a template of dated steps (§5.2). */
export const syncProtocols = pgTable(
  "sync_protocols",
  {
    ...baseColumns,
    name: text("name").notNull(),
    detail: text("detail"),
    steps: jsonb("steps")
      .$type<
        {
          dayOffset: number;
          action: string;
          label: string;
          hourOffset?: number;
          product?: string;
          notes?: string;
        }[]
      >()
      .notNull()
      .default([]),
    active: boolean("active").notNull(),
  },
  baseIndexes("sync_protocols"),
);

/** Freezer beef: what went in, what came back, and who it went to (§5.2). */
export const processingRecords = pgTable(
  "processing_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    processorId: text("processor_id"),
    deliveredOn: timestamp("delivered_on", { withTimezone: true, mode: "date" }).notNull(),
    collectedOn: timestamp("collected_on", { withTimezone: true, mode: "date" }),
    liveScaleWeightLb: doublePrecision("live_scale_weight_lb"),
    hangingWeightLb: doublePrecision("hanging_weight_lb"),
    processingCost: jsonb("processing_cost").$type<{ cents: number }>(),
    paymentReceived: jsonb("payment_received").$type<{ cents: number }>(),
    cutLines: jsonb("cut_lines")
      .$type<{ cut: string; pounds: number; disposition: string }[]>()
      .notNull()
      .default([]),
    notes: text("notes"),
  },
  baseIndexes("processing_records"),
);

/** What an animal cost to get here (§5.2). */
export const acquisitionRecords = pgTable(
  "acquisition_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    counterpartyId: text("counterparty_id"),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    price: jsonb("price").$type<{ cents: number }>().notNull(),
    type: text("type").notNull(),
    transportNotes: text("transport_notes"),
    notes: text("notes"),
  },
  baseIndexes("acquisition_records"),
);

/** What she brought, and what the barn took out of it (§5.2). */
export const saleRecords = pgTable(
  "sale_records",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    counterpartyId: text("counterparty_id"),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    price: jsonb("price").$type<{ cents: number }>().notNull(),
    type: text("type").notNull(),
    commission: jsonb("commission").$type<{ cents: number }>(),
    transportNotes: text("transport_notes"),
    notes: text("notes"),
  },
  baseIndexes("sale_records"),
);

/** What the herd is being bred toward (§5.2). */
export const geneticGoals = pgTable(
  "genetic_goals",
  {
    ...baseColumns,
    trait: text("trait").notNull(),
    direction: text("direction").notNull(),
    rationale: text("rationale"),
    active: boolean("active").notNull(),
  },
  baseIndexes("genetic_goals"),
);

/**
 * A mating before it happens (§5.2).
 *
 * `realisedAs` is the BreedingRecord it became — the planned-to-actual pattern
 * §5.9 uses everywhere: the plan becomes the fact in one tap and nothing is
 * typed twice.
 */
export const plannedMatings = pgTable(
  "planned_matings",
  {
    ...baseColumns,
    damId: text("dam_id"),
    damCriteria: text("dam_criteria"),
    method: text("method").notNull(),
    semenInventoryId: text("semen_inventory_id"),
    bullId: text("bull_id"),
    sireExternalId: text("sire_external_id"),
    targetSeason: text("target_season"),
    targetDate: timestamp("target_date", { withTimezone: true, mode: "date" }),
    rationale: text("rationale"),
    planStatus: text("plan_status").notNull(),
    realisedAs: text("realised_as"),
    realisedAt: timestamp("realised_at", { withTimezone: true, mode: "date" }),
    abandonedReason: text("abandoned_reason"),
  },
  baseIndexes("planned_matings"),
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

/**
 * What something gets fed (§5.1), across all three scopes.
 *
 * One table for animal-, zone-, and group-targeted plans, because §5.1 makes a
 * per-cow mixture "an animal-targeted plan that overrides/extends the group
 * plan" — three tables would need the override rule written three times, and
 * §5.3's daily-demand sum would have to union them.
 *
 * `lines` is jsonb rather than a child table for the §4.2 reason above: the
 * sync engine patches fields, and a plan's lines change as a unit.
 */
/**
 * The feed catalogue (§5.3).
 *
 * Cross-species on purpose: the same round bale feeds cattle and the same
 * scratch feeds chickens, so this is one list rather than one per animal type.
 * A feeding plan's lines name an entry here, which is what makes "40 lb a head
 * a day" and "three bales" comparable at all.
 */
export const feedTypes = pgTable(
  "feed_types",
  {
    ...baseColumns,
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
    /** A round bale is 800 to 1,400 lb depending on who baled it. */
    estWeightLbPerUnit: doublePrecision("est_weight_lb_per_unit"),
    currentUnitCost: jsonb("current_unit_cost").$type<{ cents: number }>(),
    reorderLeadDays: integer("reorder_lead_days").notNull(),
    reorderThreshold: doublePrecision("reorder_threshold"),
    active: boolean("active").notNull(),
    notes: text("notes"),
  },
  baseIndexes("feed_types"),
);

export const feedingPlans = pgTable(
  "feeding_plans",
  {
    ...baseColumns,
    name: text("name").notNull(),
    target: text("target").notNull(),
    targetId: text("target_id").notNull(),
    lines: jsonb("lines")
      .$type<
        {
          feedTypeId: string;
          amount: { amount: number; unit: string };
          frequency: string;
          timeOfDay: string;
          notes?: string;
        }[]
      >()
      .notNull()
      .default([]),
    active: boolean("active").notNull(),
    specialNotes: text("special_notes"),
  },
  baseIndexes("feeding_plans"),
);

/**
 * Feed bought and feed used (§5.3, issue #18).
 *
 * Both are append-only logs, and the on-hand count is derived from them rather
 * than stored — §4.5's rule for a running total: the log entries carry the
 * CRUD and the total re-derives. A stored count would drift the first time
 * somebody edited a purchase.
 */
export const feedPurchases = pgTable(
  "feed_purchases",
  {
    ...baseColumns,
    feedTypeId: text("feed_type_id").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unitCost: jsonb("unit_cost").$type<{ cents: number }>().notNull(),
    vendorContactId: text("vendor_contact_id"),
    purchasedOn: timestamp("purchased_on", { withTimezone: true }).notNull(),
    notes: text("notes"),
  },
  baseIndexes("feed_purchases"),
);

export const feedConsumption = pgTable(
  "feed_consumption",
  {
    ...baseColumns,
    feedTypeId: text("feed_type_id").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    kind: text("kind").notNull(),
    usedOn: timestamp("used_on", { withTimezone: true }).notNull(),
    animalId: text("animal_id"),
    zoneId: text("zone_id"),
    notes: text("notes"),
  },
  baseIndexes("feed_consumption"),
);

/**
 * Breeding soundness exams (§5.2).
 *
 * The cheapest insurance on a cattle operation and the one most often skipped
 * — a bull that fails does not look any different in the pasture.
 */
export const fertilityTests = pgTable(
  "fertility_tests",
  {
    ...baseColumns,
    animalId: text("animal_id").notNull(),
    date: timestamp("date", { withTimezone: true, mode: "date" }).notNull(),
    verdict: text("verdict").notNull(),
    scrotalCircumferenceCm: doublePrecision("scrotal_circumference_cm"),
    motilityPercent: doublePrecision("motility_percent"),
    morphologyPercent: doublePrecision("morphology_percent"),
    vet: text("vet"),
    retestDueOn: timestamp("retest_due_on", { withTimezone: true, mode: "date" }),
    notes: text("notes"),
  },
  baseIndexes("fertility_tests"),
);

/**
 * Poultry (§5.4).
 *
 * A flock rather than a row per bird: eighteen hens are one record with a
 * headcount, and §5.4 makes quail a value in `species` rather than a second
 * module — which is why nothing here is named for chickens.
 *
 * `opening_count` is the count when the flock was first written down. It is
 * not the count now: that derives from this plus the adjustment log, per
 * §4.5's rule for a running total. A stored headcount would answer "how many
 * birds" and nothing else; the log answers "we lost four to something on
 * Tuesday", which is the fact worth keeping.
 */
export const flocks = pgTable(
  "flocks",
  {
    ...baseColumns,
    name: text("name").notNull(),
    species: text("species").notNull(),
    /** The coop, as a Zone. */
    zoneId: text("zone_id"),
    breedMix: text("breed_mix"),
    openingCount: integer("opening_count").notNull(),
    active: boolean("active").notNull(),
    notes: text("notes"),
  },
  baseIndexes("flocks"),
);

export const flockAdjustments = pgTable(
  "flock_adjustments",
  {
    ...baseColumns,
    flockId: text("flock_id").notNull(),
    reason: text("reason").notNull(),
    quantity: integer("quantity").notNull(),
    occurredOn: timestamp("occurred_on", { withTimezone: true, mode: "date" }).notNull(),
    notes: text("notes"),
  },
  baseIndexes("flock_adjustments"),
);

/**
 * A collection (§5.4).
 *
 * The total is the required field and the breakdown is optional, because the
 * kiosk entry for this is a row of +1 buttons at the coop (§4.4) and a log that
 * demanded a colour and a size per egg is a log nobody fills in. The breakdown
 * is one jsonb column rather than a child table for the reason §4.2 gives:
 * sync patches *fields*, and a morning's rows change as a unit.
 */
export const eggLogs = pgTable(
  "egg_logs",
  {
    ...baseColumns,
    flockId: text("flock_id"),
    zoneId: text("zone_id"),
    collectedOn: timestamp("collected_on", { withTimezone: true, mode: "date" }).notNull(),
    total: integer("total").notNull(),
    breakdown: jsonb("breakdown")
      .$type<{ colour: string; size: string; count: number }[]>()
      .notNull()
      .default([]),
    notes: text("notes"),
  },
  baseIndexes("egg_logs"),
);

/** Where the eggs went (§5.4) — kept, given, or sold, with the money if sold. */
export const eggDispositions = pgTable(
  "egg_dispositions",
  {
    ...baseColumns,
    disposedOn: timestamp("disposed_on", { withTimezone: true, mode: "date" }).notNull(),
    quantity: integer("quantity").notNull(),
    kind: text("kind").notNull(),
    contactId: text("contact_id"),
    /** What that lot brought, not a price per egg. Only a sale carries one. */
    price: jsonb("price").$type<{ cents: number }>(),
    notes: text("notes"),
  },
  baseIndexes("egg_dispositions"),
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

/**
 * The hand-entered half of the calendar (§5.1).
 *
 * Only this half is stored. Calving windows, withdrawal ends, run-outs and
 * maintenance due dates are projections over records that already exist, and
 * storing them would give a corrected breeding date two answers.
 */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    ...baseColumns,
    title: text("title").notNull(),
    detail: text("detail"),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }),
    allDay: boolean("all_day").notNull(),
    zoneId: text("zone_id"),
    animalId: text("animal_id"),
  },
  baseIndexes("calendar_events"),
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
    budgetEstimate: jsonb("budget_estimate").$type<{ cents: number }>(),
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
    askingPrice: jsonb("asking_price").$type<{ cents: number }>().notNull(),
    /** Hauling, inspection, repairs — the costs that decide the purchase. */
    additionalCosts: jsonb("additional_costs")
      .$type<{ label: string; amount: { cents: number } }[]>()
      .notNull()
      .default([]),
    listingUrl: text("listing_url"),
    sellerId: text("seller_id"),
    location: text("location"),
    /** Fractional: "12.4 miles" is a real answer and integer miles would round it. */
    distanceMiles: doublePrecision("distance_miles"),
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
    /**
     * The domain-specific half — §5.2's `CattleCandidateDetail`, and whatever
     * equipment and horses add later.
     *
     * A column rather than a table because the detail is one-per-candidate and
     * is never queried on its own, and because it is not a `BaseRecord` — it
     * has no id of its own to sync by. As jsonb it rides along with its
     * candidate as one field, which is what the field-level merge wants: the
     * whole detail changes as a unit.
     */
    domainDetail: jsonb("domain_detail").$type<Record<string, unknown>>(),
  },
  baseIndexes("purchase_candidates"),
);

/**
 * People who can sign in (spec §4.3).
 *
 * In our own database rather than a provider's, which is what makes §10's
 * move home a `pg_dump | pg_restore` rather than a re-registration of every
 * account. Auth.js is a credentials provider over this table; no vendor holds
 * the identity.
 *
 * `passwordHash` is a scrypt hash with its parameters and salt encoded in the
 * string — see `@galaxy-farm/infra-auth`. Sessions are JWTs, so there is no
 * session table to keep in step.
 */
export const users = pgTable(
  "users",
  {
    ...baseColumns,
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    /**
     * Null until they accept an invitation and choose one themselves.
     *
     * Nobody sets somebody else's password here: a password two people know
     * arrives over whatever channel was to hand and is almost never changed
     * afterwards.
     */
    passwordHash: text("password_hash"),
    /** The hash of the invitation token, never the token. Cleared on use. */
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true, mode: "date" }),
    /** Set for `housesitter`: outside this window they have no access at all. */
    accessFrom: timestamp("access_from", { withTimezone: true, mode: "date" }),
    accessTo: timestamp("access_to", { withTimezone: true, mode: "date" }),
    /** Set for `customer`: their contact record in the CRM. */
    contactId: text("contact_id"),
    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true, mode: "date" }),
    active: boolean("active").notNull().default(true),
  },
  baseIndexes("users"),
);

/**
 * Paired barn screens (spec §4.4).
 *
 * A device holds a long-lived token rather than a person's session, because
 * the screen is unattended and the person who paired it goes home. Revocable
 * by id and not editable — a §4.5 system-owned row.
 */
export const kioskDevices = pgTable(
  "kiosk_devices",
  {
    ...baseColumns,
    name: text("name").notNull(),
    /** Hashed like a password: a leaked table must not be a set of keys. */
    tokenHash: text("token_hash").notNull(),
    /** One-time pairing code, cleared once used. */
    pairingCode: text("pairing_code"),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true, mode: "date" }),
    pairedAt: timestamp("paired_at", { withTimezone: true, mode: "date" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    /** Lock the screen to one board, per §4.4. */
    lockedToBoard: text("locked_to_board"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  baseIndexes("kiosk_devices"),
);

/**
 * Who last wrote each field, and when (§4.2).
 *
 * The merge is per-field last-write-wins, so the server has to know when each
 * *field* was last written. The row's `updated_at` cannot answer that: a device
 * that edits `notes` offline on Monday and pushes on Wednesday would lose the
 * edit to an unrelated change of `name` on Tuesday — silently, and in exactly
 * the offline case this whole architecture exists to serve.
 *
 * A row per field rather than a JSON blob per record, so two pushes touching
 * different fields of one record cannot lose each other's update through a
 * read-modify-write. Kept out of the entity tables because it is sync
 * bookkeeping: the domain types know nothing about it and it never crosses the
 * wire on a pull.
 */
export const syncFieldMeta = pgTable(
  "sync_field_meta",
  {
    entity: text("entity").notNull(),
    recordId: text("record_id").notNull(),
    field: text("field").notNull(),
    propertyId: text("property_id").notNull(),
    /** When the field changed on the device that wrote it, not on arrival. */
    writtenAt: timestamp("written_at", { withTimezone: true, mode: "date" }).notNull(),
    writtenBy: text("written_by").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entity, table.recordId, table.field] }),
    index("sync_field_meta_record_idx").on(table.entity, table.recordId),
  ],
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
  pastureCareLogs,
  animals,
  cattleProfiles,
  externalAnimals,
  breedingRecords,
  calvingRecords,
  weightRecords,
  healthRecords,
  heatRecords,
  medInventory,
  semenInventory,
  syncProtocols,
  processingRecords,
  acquisitionRecords,
  saleRecords,
  geneticGoals,
  plannedMatings,
  zoneAssignments,
  feedTypes,
  feedingPlans,
  feedPurchases,
  feedConsumption,
  fertilityTests,
  flocks,
  flockAdjustments,
  eggLogs,
  eggDispositions,
  contacts,
  attachments,
  choreTemplates,
  tasks,
  calendarEvents,
  roadmapItems,
  purchaseCandidates,
  users,
  kioskDevices,
  syncAudit,
  syncFieldMeta,
};
