import { describe, expect, it } from "vitest";

import { ENTITY_WRITE_CAPABILITY } from "@galaxy-farm/core";

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
  "beds",
  "crops",
  "varieties",
  "seedInventory",
  "plantings",
  "gardenCareLogs",
  "harvestLogs",
  "preservationLogs",
  "seasonPlans",
  "plannedPlantings",
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
];

describe("the local schema version tracks the store list", () => {
  it("holds exactly the pinned entities at the pinned version", () => {
    expect([...LOCAL_STORES]).toEqual(PINNED_STORES);
    // 16, not 15: the garden took 15 and the photo upload queue took 16. The
    // queue is not in LOCAL_STORES — it holds bytes rather than records and
    // never syncs — so this is the one version bump the store list above does
    // not explain on its own.
    expect(LOCAL_SCHEMA_VERSION).toBe(16);
  });

  it("names each store once", () => {
    // A duplicate would build two DexieRepository instances for one table and
    // the second would silently win.
    expect(new Set(LOCAL_STORES).size).toBe(LOCAL_STORES.length);
  });
});

describe("the entities that need more than records.write", () => {
  it("names stores that exist", () => {
    // The kernel keys this table by the entity name a `Patch` carries, which
    // is the local store's name for it — and the two live in different
    // packages, so nothing but this compares them. A key that matched no store
    // would not fail anywhere: the push handler's lookup would miss and fall
    // through to `records.write`, quietly granting the permission the entry
    // exists to withhold.
    for (const entity of Object.keys(ENTITY_WRITE_CAPABILITY)) {
      expect(LOCAL_STORES, entity).toContain(entity);
    }
  });
});
