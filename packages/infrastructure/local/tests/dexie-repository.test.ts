import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, it } from "vitest";

import {
  repositoryConformanceCases,
  unsearchableRepositoryCases,
  type ConformanceRecord,
} from "@galaxy-farm/core/testing";

import { FarmDatabase } from "../src/database.js";
import { DexieRepository } from "../src/dexie-repository.js";

/**
 * The IndexedDB store runs the same contract as the in-memory and Postgres
 * implementations. A disagreement between the local store and the server store
 * surfaces as data appearing on one device and not another — the hardest class
 * of bug to notice in this app, and the reason this suite is shared rather than
 * written twice.
 */

const open: FarmDatabase[] = [];

function freshDatabase(): FarmDatabase {
  // A new IDBFactory per case gives each test its own isolated storage.
  const db = new FarmDatabase({
    name: `conformance-${open.length}`,
    stores: ["records"],
    indexedDB: new IDBFactory(),
    iDBKeyRange: FakeIDBKeyRange as unknown as typeof IDBKeyRange,
  });
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

describe("DexieRepository — repository contract", () => {
  for (const testCase of repositoryConformanceCases) {
    it(testCase.name, async () => {
      const repository = new DexieRepository<ConformanceRecord>(freshDatabase(), "records", [
        "name",
      ]);
      await testCase.run(repository);
    });
  }

  for (const testCase of unsearchableRepositoryCases) {
    it(testCase.name, async () => {
      await testCase.run(new DexieRepository<ConformanceRecord>(freshDatabase(), "records", []));
    });
  }
});
