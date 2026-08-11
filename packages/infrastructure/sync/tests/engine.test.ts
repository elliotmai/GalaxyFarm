import { describe, expect, it, vi } from "vitest";

import { InMemoryRepository, fixedClock, type BaseRecord, type Ulid } from "@galaxy-farm/core";

import { InMemoryOutbox } from "../src/outbox.js";
import { SyncEngine } from "../src/engine.js";
import type { Patch, PullPage, PushResult, SyncTransport } from "@galaxy-farm/core";

/**
 * The reconciliation loop, driven against a transport that fails, delays, and
 * reorders — because this code only ever misbehaves on a bad connection in a
 * metal barn, and that is not somewhere you can debug comfortably.
 */

interface Cow extends BaseRecord {
  readonly name: string;
}

const propertyId = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const at = new Date("2026-06-01T10:00:00Z");

let idCounter = 0;
const ids = {
  next: (): Ulid => `01ARZ3NDEKTSV4RRFFQ69G5F${String(idCounter++).padStart(2, "0")}` as Ulid,
};

const cow = (id: string, overrides: Partial<Cow> = {}): Cow => ({
  id: id as Ulid,
  propertyId,
  createdAt: at,
  updatedAt: at,
  name: "Dolly",
  ...overrides,
});

const patch = (recordId: string): Patch => ({
  entity: "Animal",
  recordId: recordId as Ulid,
  changes: [{ field: "name", value: "Dolly", at, deviceId: "barn" }],
});

function harness(transport: Partial<SyncTransport<Cow>> = {}, clockAt: Date = at) {
  const outbox = new InMemoryOutbox();
  const repository = new InMemoryRepository<Cow>(["name"]);
  const pushed: (readonly unknown[])[] = [];

  const fullTransport: SyncTransport<Cow> = {
    push: async (entries) => {
      pushed.push(entries);
      return { accepted: entries.map((e) => e.id), rejected: [], audit: [] } satisfies PushResult;
    },
    pull: async () => [],
    ...transport,
  };

  const engine = new SyncEngine<Cow>({
    outbox,
    transport: fullTransport,
    repositories: new Map([["Animal", repository]]),
    clock: fixedClock(clockAt),
    ids,
    deviceId: "barn",
  });

  return { engine, outbox, repository, pushed };
}

describe("enqueue", () => {
  it("queues a mutation without needing a connection", async () => {
    const { engine, outbox } = harness();

    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    expect(await outbox.size()).toBe(1);
  });

  it("stamps the entry with the device and the queue time", async () => {
    const { engine } = harness();

    const entry = await engine.enqueue("create", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    expect(entry.deviceId).toBe("barn");
    expect(entry.queuedAt).toEqual(at);
    expect(entry.attempts).toBe(0);
  });
});

describe("push", () => {
  it("drains the outbox when the server accepts", async () => {
    const { engine, outbox } = harness();
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    const result = await engine.push();

    expect(result.pushed).toBe(1);
    expect(await outbox.size()).toBe(0);
  });

  it("keeps everything when the server is unreachable", async () => {
    // The durability property. A failed push must lose nothing, or work done
    // in the barn disappears the moment someone drives out of signal.
    const { engine, outbox } = harness({
      push: async () => {
        throw new Error("network unreachable");
      },
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    const result = await engine.push();

    expect(result.offline).toBe(true);
    expect(result.pushed).toBe(0);
    expect(await outbox.size()).toBe(1);
  });

  it("records the failure so backoff can space out the retry", async () => {
    const { engine, outbox } = harness({
      push: async () => {
        throw new Error("network unreachable");
      },
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));
    await engine.push();

    const [entry] = await outbox.pending();
    expect(entry?.attempts).toBe(1);
    expect(entry?.lastError).toBe("network unreachable");
  });

  it("keeps a rejected entry but drops an accepted one from the same batch", async () => {
    const { engine, outbox } = harness({
      push: async (entries) => ({
        accepted: [entries[0]!.id],
        rejected: [{ id: entries[1]!.id, reason: "validation failed" }],
        audit: [],
      }),
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR2"));

    const result = await engine.push();

    expect(result.pushed).toBe(1);
    expect(result.rejected).toBe(1);
    expect(await outbox.size()).toBe(1);
  });

  it("does nothing when the outbox is empty, rather than calling the server", async () => {
    const { engine, pushed } = harness();

    const result = await engine.push();

    expect(result.pushed).toBe(0);
    expect(pushed).toHaveLength(0);
  });

  it("holds a failed entry until its backoff elapses", async () => {
    const outbox = new InMemoryOutbox();
    const push = vi.fn(async () => {
      throw new Error("down");
    });
    const engine = new SyncEngine<Cow>({
      outbox,
      transport: { push, pull: async () => [] },
      repositories: new Map(),
      clock: fixedClock(at),
      ids,
      deviceId: "barn",
    });

    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));
    await engine.push();
    // The clock is fixed, so no time has passed and the entry is still cooling.
    await engine.push();

    expect(push).toHaveBeenCalledOnce();
  });

  it("surfaces the server's conflict resolutions", async () => {
    const auditEntry = {
      entity: "Animal",
      recordId: "01ARZ3NDEKTSV4RRFFQ69G5FR1" as Ulid,
      field: "name",
      winner: { value: "Dolly II", at, deviceId: "house" },
      loser: { value: "Dolly", at, deviceId: "barn" },
      resolvedAt: at,
    };
    const { engine } = harness({
      push: async (entries) => ({
        accepted: entries.map((e) => e.id),
        rejected: [],
        audit: [auditEntry],
      }),
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    const result = await engine.push();

    expect(result.audit).toEqual([auditEntry]);
  });
});

describe("pull", () => {
  const page = (records: Cow[], hasMore = false): PullPage<Cow>[] => [
    { entity: "Animal", records, hasMore },
  ];

  it("writes pulled records into the local store", async () => {
    const { engine, repository } = harness({
      pull: async () => page([cow("01ARZ3NDEKTSV4RRFFQ69G5FR1")]),
    });

    const result = await engine.pull();

    expect(result.pulled).toBe(1);
    expect(await repository.count({ propertyId })).toBe(1);
  });

  it("advances the cursor past what it received", async () => {
    const { engine } = harness({
      pull: async () =>
        page([cow("01ARZ3NDEKTSV4RRFFQ69G5FR1", { updatedAt: new Date("2026-06-02T00:00:00Z") })]),
    });

    await engine.pull();

    expect(engine.cursorForEntity("Animal")?.updatedAt).toEqual(new Date("2026-06-02T00:00:00Z"));
  });

  it("applies a tombstone rather than deleting locally", async () => {
    // A deletion travels as a record. Deleting the local row instead would
    // leave nothing to replicate, and the record would come back on the next
    // pull from a device that never saw the deletion.
    const { engine, repository } = harness({
      pull: async () =>
        page([
          cow("01ARZ3NDEKTSV4RRFFQ69G5FR1", {
            deletedAt: at,
            deletedBy: propertyId,
          }),
        ]),
    });

    await engine.pull();

    expect(await repository.count({ propertyId })).toBe(0);
    expect(await repository.count({ propertyId, includeDeleted: true })).toBe(1);
  });

  it("does not resurrect a record deleted elsewhere", async () => {
    const { engine, repository } = harness({
      pull: async () =>
        page([cow("01ARZ3NDEKTSV4RRFFQ69G5FR1", { deletedAt: at, deletedBy: propertyId })]),
    });
    await repository.save(cow("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    await engine.pull();

    expect(await repository.count({ propertyId })).toBe(0);
  });

  it("survives an unreachable server without losing its cursor", async () => {
    const { engine } = harness({
      pull: async () => {
        throw new Error("down");
      },
    });

    const result = await engine.pull();

    expect(result.offline).toBe(true);
    expect(engine.cursorForEntity("Animal")).toBeUndefined();
  });

  it("ignores a page for an entity it has no store for", async () => {
    const { engine } = harness({
      pull: async () => [
        { entity: "Unknown", records: [cow("01ARZ3NDEKTSV4RRFFQ69G5FR1")], hasMore: false },
      ],
    });

    expect((await engine.pull()).pulled).toBe(0);
  });

  it("keeps pulling while the server says there is more", async () => {
    // A device that has been off for a week is the one furthest behind, and
    // stopping after one page would leave it that way.
    const cows = [
      cow("01ARZ3NDEKTSV4RRFFQ69G5FR1", { updatedAt: new Date("2026-06-01T00:00:01Z") }),
      cow("01ARZ3NDEKTSV4RRFFQ69G5FR2", { updatedAt: new Date("2026-06-01T00:00:02Z") }),
      cow("01ARZ3NDEKTSV4RRFFQ69G5FR3", { updatedAt: new Date("2026-06-01T00:00:03Z") }),
    ];
    let round = 0;
    const { engine, repository } = harness({
      pull: async () => {
        const record = cows[round];
        round += 1;
        return record === undefined ? page([]) : page([record], round < cows.length);
      },
    });

    const result = await engine.pull();

    expect(result.pulled).toBe(3);
    expect(await repository.count({ propertyId })).toBe(3);
  });

  it("stops when a round says there is more but sends nothing", async () => {
    // A server that always claims more would otherwise spin this loop until
    // the round ceiling, on every single sync.
    let calls = 0;
    const { engine } = harness({
      pull: async () => {
        calls += 1;
        return page([], true);
      },
    });

    await engine.pull();

    expect(calls).toBe(1);
  });

  it("keeps what earlier rounds wrote when the connection drops mid-catch-up", async () => {
    let round = 0;
    const { engine, repository } = harness({
      pull: async () => {
        round += 1;
        if (round > 1) throw new Error("down");
        return page([cow("01ARZ3NDEKTSV4RRFFQ69G5FR1")], true);
      },
    });

    const result = await engine.pull();

    expect(result).toEqual({ pulled: 1, offline: true });
    expect(await repository.count({ propertyId })).toBe(1);
    // The cursor moved with the page, so the next sync resumes from there
    // rather than replaying everything the device already holds.
    expect(engine.cursorForEntity("Animal")).toBeDefined();
  });

  it("restores cursors after a restart so it does not start from scratch", async () => {
    const { engine } = harness();
    engine.restoreCursors({
      Animal: { entity: "Animal", updatedAt: at, lastId: "01ARZ3NDEKTSV4RRFFQ69G5FR1" },
    });

    expect(engine.cursorForEntity("Animal")?.lastId).toBe("01ARZ3NDEKTSV4RRFFQ69G5FR1");
  });
});

describe("sync", () => {
  it("pushes before pulling", async () => {
    // Sending local work first means the server has already seen it when the
    // pull response is built, so a device does not immediately receive a stale
    // version of the row it just changed.
    const order: string[] = [];
    const { engine } = harness({
      push: async (entries) => {
        order.push("push");
        return { accepted: entries.map((e) => e.id), rejected: [], audit: [] };
      },
      pull: async () => {
        order.push("pull");
        return [];
      },
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));

    await engine.sync();

    expect(order).toEqual(["push", "pull"]);
  });

  it("reports offline if either half could not reach the server", async () => {
    const { engine } = harness({
      pull: async () => {
        throw new Error("down");
      },
    });

    expect((await engine.sync()).offline).toBe(true);
  });

  it("reports what it moved in both directions", async () => {
    const { engine } = harness({
      pull: async () => [
        { entity: "Animal", records: [cow("01ARZ3NDEKTSV4RRFFQ69G5FR1")], hasMore: false },
      ],
    });
    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR2"));

    const outcome = await engine.sync();

    expect(outcome.pushed).toBe(1);
    expect(outcome.pulled).toBe(1);
    expect(outcome.offline).toBe(false);
  });

  it("a write made offline still reaches the server once signal returns", async () => {
    // The end-to-end property the whole design exists for: log a treatment in
    // the barn with no bars, drive back to the house, and it lands.
    let online = false;
    let nowMs = at.getTime();
    const outbox = new InMemoryOutbox();
    const engine = new SyncEngine<Cow>({
      outbox,
      transport: {
        push: async (entries) => {
          if (!online) throw new Error("no signal");
          return { accepted: entries.map((e) => e.id), rejected: [], audit: [] };
        },
        pull: async () => [],
      },
      repositories: new Map(),
      clock: { now: () => new Date(nowMs) },
      ids,
      deviceId: "barn",
    });

    await engine.enqueue("update", patch("01ARZ3NDEKTSV4RRFFQ69G5FR1"));
    await engine.sync();
    expect(await engine.pendingCount()).toBe(1);

    online = true;

    // Retrying in the same instant is correctly refused — the entry is still
    // inside its backoff window, which is what stops a flaky connection
    // becoming a hot loop.
    await engine.sync();
    expect(await engine.pendingCount()).toBe(1);

    nowMs += 2_000;
    await engine.sync();

    expect(await engine.pendingCount()).toBe(0);
  });
});
