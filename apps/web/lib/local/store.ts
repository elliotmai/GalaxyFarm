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
  "animals",
  "zoneAssignments",
  "contacts",
  "attachments",
  "choreTemplates",
  "tasks",
  "roadmapItems",
  "purchaseCandidates",
] as const;

export type LocalStoreName = (typeof LOCAL_STORES)[number];

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
  animals: ["name", "tagNumber", "notes"],
  zoneAssignments: [],
  contacts: ["name", "company", "address", "notes"],
  attachments: ["filename", "caption"],
  choreTemplates: ["title", "detail"],
  tasks: ["title", "detail"],
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

  const db = new FarmDatabase({ stores: [...LOCAL_STORES] });
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
