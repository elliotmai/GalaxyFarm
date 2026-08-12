import type { BaseRecord } from "@galaxy-farm/core";

import { allTables } from "../schema/index.js";
import { PostgresRepository, type Database, type RecordTable } from "./postgres-repository.js";

export * from "./postgres-repository.js";

/**
 * What `ListQuery.search` looks at, per table.
 *
 * Kept in one list rather than at each call site because "search finds nothing"
 * is a bug nobody reports — they assume the record is not there and enter it
 * again. A table missing from this map fails a test, so the choice has to be
 * made deliberately, including the choice that a table has nothing worth
 * searching.
 *
 * The two sync bookkeeping tables are absent on purpose: `syncAudit` is
 * append-only and on the §4.5 exception list, and `syncFieldMeta` holds
 * per-field write times. Neither is a `Repository`.
 *
 * `users` and `kioskDevices` **are** here — they are administered through the
 * app like anything else — but they never sync to a device. See
 * `NOT_SYNCED` in `../sync/entities.ts`.
 */
export const SEARCHABLE_FIELDS = {
  properties: ["name", "address"],
  brandingConfigs: ["farmName", "businessName", "tagline"],
  waterSources: ["name", "notes"],
  zones: ["name", "customInstructions"],
  pastureCareLogs: ["product", "notes"],
  animals: ["name", "tagNumber", "notes"],
  cattleProfiles: ["colour", "markings"],
  externalAnimals: ["name", "regNumber"],
  breedingRecords: ["notes", "embryoCode"],
  calvingRecords: ["notes", "assistDetail"],
  healthRecords: ["product", "notes", "administeredBy"],
  // A heat is found through its cow and its date, never by typing.
  heatRecords: ["notes", "observedBy"],
  medInventory: ["product", "lotNumber", "storageLocation", "notes"],
  semenInventory: ["sireName", "tank", "canister", "cane", "source", "notes"],
  syncProtocols: ["name", "detail"],
  processingRecords: ["notes"],
  acquisitionRecords: ["notes", "transportNotes"],
  saleRecords: ["notes", "transportNotes"],
  geneticGoals: ["trait", "rationale"],
  plannedMatings: ["damCriteria", "targetSeason", "rationale"],
  // A weight is found through its animal. Searching "800" across every weight
  // on the property returns a list nobody can act on.
  weightRecords: ["notes"],
  // Assignments are found through the animal or the zone, never by typing.
  zoneAssignments: [],
  feedTypes: ["name", "notes"],
  feedPurchases: ["notes"],
  feedConsumption: ["notes"],
  feedingPlans: ["name", "specialNotes"],
  contacts: ["name", "company", "address", "notes"],
  attachments: ["filename", "caption"],
  choreTemplates: ["title", "detail"],
  tasks: ["title", "detail"],
  calendarEvents: ["title", "detail"],
  roadmapItems: ["title", "detail"],
  purchaseCandidates: ["title", "location", "notes"],
  users: ["email", "name"],
  kioskDevices: ["name"],
} as const satisfies Partial<Record<keyof typeof allTables, readonly string[]>>;

export type RepositoryName = keyof typeof SEARCHABLE_FIELDS;

/**
 * A repository for one table, with its searchable fields already applied.
 *
 * The entity type is supplied by the caller — the schema states the storage and
 * the kernel states the domain type, and this is the one place they meet.
 */
export function repositoryFor<T extends BaseRecord>(
  db: Database,
  name: RepositoryName,
): PostgresRepository<T> {
  return new PostgresRepository<T>(
    db,
    allTables[name] as RecordTable,
    SEARCHABLE_FIELDS[name] as readonly (keyof T & string)[],
  );
}
