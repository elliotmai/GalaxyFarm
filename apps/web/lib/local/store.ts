import {
  DexieOutbox,
  DexieRepository,
  FarmDatabase,
  type StoredRecord,
} from "@galaxy-farm/infra-local";
import { SyncEngine } from "@galaxy-farm/infra-sync";
import { encodeUlid, systemClock, type BaseRecord, type Repository } from "@galaxy-farm/core";

import { httpTransport } from "@/lib/local/transport";

/**
 * The device's copy of the farm (spec §4.2).
 *
 * Every read in the app comes from here, never from the network. That is what
 * makes a barn at zero bars usable, and it is also why Neon's cold starts are
 * invisible: nothing anyone is looking at ever waits on the database.
 *
 * The entity list is the same one the server offers, minus nothing — the
 * server already refuses to sync the credential tables, so a device could not
 * ask for them even by name.
 */

/** Everything a device holds. Mirrors `SYNCED_ENTITIES` on the server. */
export const LOCAL_STORES = [
  "properties",
  "brandingConfigs",
  "waterSources",
  "zones",
  "pastureCareLogs",
  "animals",
  "cattleProfiles",
  "externalAnimals",
  "breedingRecords",
  "calvingRecords",
  "weightRecords",
  "healthRecords",
  "heatRecords",
  "medInventory",
  "semenInventory",
  "syncProtocols",
  "processingRecords",
  "acquisitionRecords",
  "saleRecords",
  "geneticGoals",
  "plannedMatings",
  "zoneAssignments",
  "fertilityTests",
  "feedTypes",
  "feedPurchases",
  "feedConsumption",
  "feedingPlans",
  "flocks",
  "flockAdjustments",
  "eggLogs",
  "eggDispositions",
  "equipment",
  "meterReadings",
  "maintenanceRules",
  "maintenanceLogs",
  "fuelLogs",
  "supplyItems",
  "supplyPurchases",
  "supplyUsage",
  "durableAssignments",
  "contacts",
  "attachments",
  "careGuides",
  "guideSections",
  "choreTemplates",
  "tasks",
  "calendarEvents",
  "roadmapItems",
  "purchaseCandidates",
] as const;

export type LocalStoreName = (typeof LOCAL_STORES)[number];

/**
 * Bump this whenever `LOCAL_STORES` changes.
 *
 * IndexedDB creates object stores only during a version upgrade, so a device
 * that has opened the app before keeps exactly the tables it had. Adding an
 * entity without moving this number means the first write to it throws
 * `InvalidTableError` — on the returning devices only, which are the ones with
 * unsynced work on them. `tests/local-schema.test.ts` fails the build if the
 * list changes and this does not.
 *
 * 2 — the outbox arrived.
 * 3 — pasture care logs, feeding plans, calendar events (spec §5.1).
 * 4 — cattle profiles and external animals: papers and pedigree (§5.2).
 * 5 — breeding records, and every date derived from them (§5.2).
 * 6 — calving records and weights: the calf, and how it grows (§5.2).
 * 7 — the rest of §5.2: health, heats, the medicine fridge, the semen tank,
 *     sync protocols, processing, what animals cost and brought, and the
 *     genetic plan.
 * 8 — the feed catalogue, so a plan's lines can name what they feed (§5.3).
 * 12 — the flock, its headcount log, and the eggs (§5.4).
 * 13 — the Kit: the fleet with its meters, rules, service and fuel (§5.6), and
 *      the supply shelf with its purchases, usage and durables (§5.11).
 * 14 — the care guide and its hand-written sections (§5.10).
 */
export const LOCAL_SCHEMA_VERSION = 14;

/**
 * Which fields each entity's search box looks at.
 *
 * The same choices the server makes, for the same reason: "search finds
 * nothing" is a bug nobody reports — they assume the record is not there and
 * enter it again. A device searching differently from the server would be a
 * quieter version of the same thing.
 */
const SEARCHABLE: Readonly<Record<LocalStoreName, readonly string[]>> = {
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
  weightRecords: ["notes"],
  healthRecords: ["product", "notes", "administeredBy"],
  heatRecords: ["notes", "observedBy"],
  medInventory: ["product", "lotNumber", "storageLocation", "notes"],
  semenInventory: ["sireName", "tank", "canister", "cane", "source", "notes"],
  syncProtocols: ["name", "detail"],
  processingRecords: ["notes"],
  acquisitionRecords: ["notes", "transportNotes"],
  saleRecords: ["notes", "transportNotes"],
  geneticGoals: ["trait", "rationale"],
  plannedMatings: ["damCriteria", "targetSeason", "rationale"],
  zoneAssignments: [],
  fertilityTests: ["vet", "notes"],
  feedTypes: ["name", "notes"],
  feedPurchases: ["notes"],
  feedConsumption: ["notes"],
  feedingPlans: ["name", "specialNotes"],
  flocks: ["name", "breedMix", "notes"],
  flockAdjustments: ["notes"],
  eggLogs: ["notes"],
  eggDispositions: ["notes"],
  // A serial number is what somebody has in their hand at a parts counter, so
  // it is searchable alongside the name it is never remembered by.
  equipment: ["name", "make", "model", "vin", "notes"],
  meterReadings: ["notes"],
  maintenanceRules: ["task", "parts"],
  maintenanceLogs: ["task", "parts", "notes"],
  fuelLogs: ["notes"],
  supplyItems: ["name", "storageLocation", "notes"],
  supplyPurchases: ["notes"],
  supplyUsage: ["notes"],
  durableAssignments: ["notes"],
  contacts: ["name", "company", "address", "notes"],
  attachments: ["filename", "caption"],
  careGuides: ["title", "intro"],
  guideSections: ["title", "bodyMarkdown"],
  choreTemplates: ["title", "detail"],
  tasks: ["title", "detail"],
  calendarEvents: ["title", "detail"],
  roadmapItems: ["title", "detail"],
  purchaseCandidates: ["title", "location", "notes"],
};

export interface LocalStore {
  readonly db: FarmDatabase;
  readonly engine: SyncEngine<StoredRecord>;
  repository<T extends BaseRecord>(name: LocalStoreName): DexieRepository<T>;
}

let store: LocalStore | undefined;

/**
 * The device id.
 *
 * Persisted, because it is what the merge uses to break a tie between two
 * writes with identical timestamps. A device that reintroduced itself under a
 * new name every reload would make that tie-break arbitrary in a way that
 * differs per device, and the whole point is that every device reaches the
 * same answer without talking to the others.
 */
export function deviceId(): string {
  const key = "galaxy-farm:device-id";
  const existing = globalThis.localStorage?.getItem(key);
  if (existing !== null && existing !== undefined && existing !== "") return existing;

  const fresh = encodeUlid(Date.now());
  globalThis.localStorage?.setItem(key, fresh);
  return fresh;
}

/**
 * Build the store once per tab.
 *
 * Two FarmDatabase instances would each hold their own connection and each
 * run their own sync, which is how a record ends up written twice with two
 * different device ids.
 */
export function localStore(): LocalStore {
  if (store !== undefined) return store;

  const db = new FarmDatabase({
    stores: [...LOCAL_STORES],
    schemaVersion: LOCAL_SCHEMA_VERSION,
  });
  const outbox = new DexieOutbox(db);

  const repositories = new Map<string, Repository<StoredRecord>>(
    LOCAL_STORES.map((name) => [
      name,
      new DexieRepository<StoredRecord>(db, name, SEARCHABLE[name]),
    ]),
  );

  const engine = new SyncEngine<StoredRecord>({
    outbox,
    transport: httpTransport<StoredRecord>(),
    repositories,
    clock: systemClock(),
    ids: { next: () => encodeUlid(Date.now()) },
    deviceId: deviceId(),
  });

  store = {
    db,
    engine,
    repository: <T extends BaseRecord>(name: LocalStoreName) =>
      repositories.get(name) as unknown as DexieRepository<T>,
  };

  return store;
}

/** Tests and hot reloads need a way back to a clean slate. */
export function resetLocalStore(): void {
  store = undefined;
}
