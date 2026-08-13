import { describe, expect, it } from "vitest";

import { LOCAL_SCHEMA_VERSION, LOCAL_STORES } from "../lib/local/store.js";

/**
 * The device's schema version moves when its store list does.
 *
 * IndexedDB creates object stores only during a version upgrade. A device that
 * has opened the app before keeps precisely the tables it had, so adding an
 * entity to `LOCAL_STORES` without bumping `LOCAL_SCHEMA_VERSION` breaks only
 * the returning devices — the ones carrying work that has not synced — with an
 * `InvalidTableError` on the first write. That has already happened once here,
 * to the outbox.
 *
 * Pinning the list and the version in one assertion is what makes it
 * impossible to change one silently: adding an entity fails this test, and the
 * fix is to bump both together rather than to delete the check.
 */

const PINNED_STORES = [
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
  "choreTemplates",
  "tasks",
  "calendarEvents",
  "roadmapItems",
  "purchaseCandidates",
];

describe("the local schema version tracks the store list", () => {
  it("holds exactly the pinned entities at the pinned version", () => {
    expect([...LOCAL_STORES]).toEqual(PINNED_STORES);
    expect(LOCAL_SCHEMA_VERSION).toBe(13);
  });

  it("names each store once", () => {
    // A duplicate would build two DexieRepository instances for one table and
    // the second would silently win.
    expect(new Set(LOCAL_STORES).size).toBe(LOCAL_STORES.length);
  });
});
