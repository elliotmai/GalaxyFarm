import assert from "node:assert/strict";

import type { ListQuery } from "../crud/contracts.js";
import type { BaseRecord } from "../entities/record.js";
import type { Repository } from "../ports/index.js";
import type { Ulid } from "../types/ids.js";

/**
 * One contract, three implementations.
 *
 * The in-memory, IndexedDB, and Postgres repositories all run these cases. The
 * point is not to test each of them separately — it is that the local store and
 * the server store cannot quietly disagree about what "list" means, because a
 * disagreement there shows up as data appearing on one device and not another,
 * which is the hardest class of bug to notice in this app.
 *
 * Deliberately free of any test framework: cases are plain functions, so the
 * suite can live in `src` without dragging Vitest into shipped code. Each
 * package wraps them in its own `it()`.
 */

export interface ConformanceRecord extends BaseRecord {
  readonly name: string;
  readonly tally: number;
}

export interface ConformanceHarness {
  /** A fresh, empty repository. Called before every case. */
  create(): Promise<Repository<ConformanceRecord>> | Repository<ConformanceRecord>;
  /** Release resources between cases. */
  dispose?(repository: Repository<ConformanceRecord>): Promise<void> | void;
}

export interface ConformanceCase {
  readonly name: string;
  readonly run: (repository: Repository<ConformanceRecord>) => Promise<void>;
}

const PROPERTY_A = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const PROPERTY_B = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;

const AT = new Date("2026-06-01T00:00:00Z");

function record(id: string, overrides: Partial<ConformanceRecord> = {}): ConformanceRecord {
  return {
    id: id as Ulid,
    propertyId: PROPERTY_A,
    createdAt: AT,
    updatedAt: AT,
    name: "Bale spear",
    tally: 1,
    ...overrides,
  };
}

const ID_1 = "01ARZ3NDEKTSV4RRFFQ69G5FR1";
const ID_2 = "01ARZ3NDEKTSV4RRFFQ69G5FR2";
const ID_3 = "01ARZ3NDEKTSV4RRFFQ69G5FR3";

const query = (overrides: Partial<ListQuery> = {}): ListQuery => ({
  propertyId: PROPERTY_A,
  ...overrides,
});

export const repositoryConformanceCases: readonly ConformanceCase[] = [
  {
    name: "returns undefined for an id it has never seen",
    async run(repository) {
      assert.equal(await repository.findById(ID_1 as Ulid), undefined);
    },
  },
  {
    name: "round-trips a saved record",
    async run(repository) {
      await repository.save(record(ID_1));
      const found = await repository.findById(ID_1 as Ulid);

      assert.equal(found?.id, ID_1);
      assert.equal(found?.name, "Bale spear");
    },
  },
  {
    name: "preserves Date fields as Dates, not strings",
    async run(repository) {
      // IndexedDB and Postgres both have opinions about dates. If one hands
      // back a string, every date comparison downstream silently changes
      // meaning.
      await repository.save(record(ID_1));
      const found = await repository.findById(ID_1 as Ulid);

      assert.ok(found?.createdAt instanceof Date);
      assert.equal(found?.createdAt.getTime(), AT.getTime());
    },
  },
  {
    name: "overwrites on save rather than duplicating",
    async run(repository) {
      await repository.save(record(ID_1, { tally: 1 }));
      await repository.save(record(ID_1, { tally: 9 }));

      assert.equal((await repository.findById(ID_1 as Ulid))?.tally, 9);
      assert.equal(await repository.count(query()), 1);
    },
  },
  {
    name: "saves many at once",
    async run(repository) {
      await repository.saveMany([record(ID_1), record(ID_2), record(ID_3)]);

      assert.equal(await repository.count(query()), 3);
    },
  },
  {
    name: "scopes every read to one property",
    async run(repository) {
      // §5: everything hangs off propertyId so a second location is a filter,
      // not a migration. A repository that leaks across properties breaks that.
      await repository.save(record(ID_1, { propertyId: PROPERTY_A }));
      await repository.save(record(ID_2, { propertyId: PROPERTY_B }));

      const listed = await repository.list(query());
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, ID_1);
    },
  },
  {
    name: "hides tombstones from the default read path",
    async run(repository) {
      await repository.save(record(ID_1));
      await repository.save(record(ID_2, { deletedAt: AT, deletedBy: USER }));

      const live = await repository.list(query());
      assert.deepEqual(
        live.map((r) => r.id),
        [ID_1],
      );
    },
  },
  {
    name: "reveals tombstones for Trash",
    async run(repository) {
      await repository.save(record(ID_1));
      await repository.save(record(ID_2, { deletedAt: AT, deletedBy: USER }));

      const all = await repository.list(query({ includeDeleted: true }));
      assert.equal(all.length, 2);
    },
  },
  {
    name: "counts what it would list, not what it stores",
    async run(repository) {
      await repository.save(record(ID_1));
      await repository.save(record(ID_2, { deletedAt: AT, deletedBy: USER }));

      assert.equal(await repository.count(query()), 1);
      assert.equal(await repository.count(query({ includeDeleted: true })), 2);
    },
  },
  {
    name: "orders by id, so paging is stable across calls",
    async run(repository) {
      // ULIDs sort by creation time. Without a stable order, page two can
      // repeat or skip rows that page one already returned.
      await repository.saveMany([record(ID_3), record(ID_1), record(ID_2)]);

      const listed = await repository.list(query());
      assert.deepEqual(
        listed.map((r) => r.id),
        [ID_1, ID_2, ID_3],
      );
    },
  },
  {
    name: "pages with limit and offset without overlap",
    async run(repository) {
      await repository.saveMany([record(ID_1), record(ID_2), record(ID_3)]);

      const first = await repository.list(query({ limit: 2 }));
      const second = await repository.list(query({ limit: 2, offset: 2 }));

      assert.deepEqual(
        first.map((r) => r.id),
        [ID_1, ID_2],
      );
      assert.deepEqual(
        second.map((r) => r.id),
        [ID_3],
      );
    },
  },
  {
    name: "searches case-insensitively on the searchable fields",
    async run(repository) {
      await repository.save(record(ID_1, { name: "Hay ring" }));
      await repository.save(record(ID_2, { name: "Mineral tub" }));

      const found = await repository.list(query({ search: "HAY" }));
      assert.deepEqual(
        found.map((r) => r.id),
        [ID_1],
      );
    },
  },
  {
    name: "treats an empty search as no filter",
    async run(repository) {
      await repository.saveMany([record(ID_1), record(ID_2)]);

      assert.equal((await repository.list(query({ search: "   " }))).length, 2);
    },
  },
  {
    name: "purges permanently",
    async run(repository) {
      await repository.save(record(ID_1));
      await repository.purge(ID_1 as Ulid);

      assert.equal(await repository.findById(ID_1 as Ulid), undefined);
      assert.equal(await repository.count(query({ includeDeleted: true })), 0);
    },
  },
  {
    name: "purging an unknown id is a no-op, not an error",
    async run(repository) {
      await repository.purge(ID_1 as Ulid);
    },
  },
  {
    name: "handles an empty saveMany",
    async run(repository) {
      await repository.saveMany([]);

      assert.equal(await repository.count(query()), 0);
    },
  },
];
