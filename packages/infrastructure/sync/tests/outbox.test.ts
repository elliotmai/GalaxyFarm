import { describe, expect, it } from "vitest";

import {
  InMemoryOutbox,
  MAX_ATTEMPTS,
  backoffDelayMs,
  drainableNow,
  isStuck,
  type OutboxEntry,
} from "../src/outbox.js";
import type { Ulid } from "@galaxy-farm/core";

const at = new Date("2026-05-01T10:00:00Z");

/** ULIDs sort by creation time; these are hand-ordered to make that visible. */
const ids = [
  "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  "01ARZ3NDEKTSV4RRFFQ69G5FA2",
  "01ARZ3NDEKTSV4RRFFQ69G5FA3",
] as unknown as Ulid[];

const entry = (id: Ulid, overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  operation: "update",
  patch: { entity: "Animal", recordId: ids[0]!, changes: [] },
  queuedAt: at,
  deviceId: "barn",
  attempts: 0,
  ...overrides,
});

describe("outbox", () => {
  it("drains oldest first", async () => {
    // ULIDs sort lexicographically by creation time, so chronological order
    // comes for free without a separate sequence number.
    const outbox = new InMemoryOutbox();
    await outbox.append(entry(ids[2]!));
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[1]!));

    expect((await outbox.pending()).map((e) => e.id)).toEqual(ids);
  });

  it("keeps writes until the server acknowledges them", async () => {
    // The durability property: a write made offline survives until it is
    // genuinely accepted, not until the app decides it probably worked.
    const outbox = new InMemoryOutbox();
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[1]!));

    expect(await outbox.size()).toBe(2);

    await outbox.ack([ids[0]!]);
    expect((await outbox.pending()).map((e) => e.id)).toEqual([ids[1]]);
  });

  it("is idempotent — replaying an ack does not disturb anything", async () => {
    const outbox = new InMemoryOutbox();
    await outbox.append(entry(ids[0]!));

    await outbox.ack([ids[0]!]);
    await outbox.ack([ids[0]!]);

    expect(await outbox.size()).toBe(0);
  });

  it("re-appending the same entry does not duplicate it", async () => {
    // A push retried after an ambiguous failure must not enqueue twice.
    const outbox = new InMemoryOutbox();
    await outbox.append(entry(ids[0]!));
    await outbox.append(entry(ids[0]!));

    expect(await outbox.size()).toBe(1);
  });

  it("limits a batch without losing the rest", async () => {
    const outbox = new InMemoryOutbox();
    for (const id of ids) await outbox.append(entry(id));

    expect(await outbox.pending(2)).toHaveLength(2);
    expect(await outbox.size()).toBe(3);
  });

  it("counts attempts and remembers the last error", async () => {
    const outbox = new InMemoryOutbox();
    await outbox.append(entry(ids[0]!));

    await outbox.fail(ids[0]!, "network unreachable");
    await outbox.fail(ids[0]!, "network unreachable");

    const [pending] = await outbox.pending();
    expect(pending?.attempts).toBe(2);
    expect(pending?.lastError).toBe("network unreachable");
  });

  it("ignores a failure for an entry already acknowledged", async () => {
    const outbox = new InMemoryOutbox();

    await expect(outbox.fail(ids[0]!, "gone")).resolves.toBeUndefined();
  });
});

describe("backoff", () => {
  it("does not delay a first attempt", () => {
    expect(backoffDelayMs(0)).toBe(0);
  });

  it("grows exponentially", () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(4_000);
  });

  it("caps, so a device regaining signal does not sit idle for an hour", () => {
    expect(backoffDelayMs(20)).toBe(5 * 60_000);
  });

  it("marks an entry stuck rather than retrying it forever", () => {
    expect(isStuck({ attempts: MAX_ATTEMPTS - 1 })).toBe(false);
    expect(isStuck({ attempts: MAX_ATTEMPTS })).toBe(true);
  });
});

describe("drainableNow — a flaky barn connection must not become a hot loop", () => {
  const lastAttempt = new Date("2026-05-01T10:00:00Z");

  it("drains fresh entries immediately", () => {
    expect(drainableNow([entry(ids[0]!)], lastAttempt)).toHaveLength(1);
  });

  it("holds a failed entry until its backoff has elapsed", () => {
    const failed = [entry(ids[0]!, { attempts: 3 })]; // 4s backoff

    const tooSoon = new Date(lastAttempt.getTime() + 2_000);
    const longEnough = new Date(lastAttempt.getTime() + 4_000);

    expect(drainableNow(failed, tooSoon, lastAttempt)).toHaveLength(0);
    expect(drainableNow(failed, longEnough, lastAttempt)).toHaveLength(1);
  });

  it("stops retrying a stuck entry, so it can be surfaced instead", () => {
    const stuck = [entry(ids[0]!, { attempts: MAX_ATTEMPTS })];
    const muchLater = new Date(lastAttempt.getTime() + 86_400_000);

    expect(drainableNow(stuck, muchLater, lastAttempt)).toHaveLength(0);
  });
});
