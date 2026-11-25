import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  diff,
  type FieldValue,
  type OutboxEntry,
  type Property,
  type Ulid,
} from "@galaxy-farm/core";
import {
  applyPush,
  kitchenEggLinks,
  kitchenEggSends,
  repositoryFor,
  type Database,
} from "@galaxy-farm/infra-db";

import type { KitchenEggConfig, KitchenEggRecord } from "../lib/kitchen-eggs.js";

/**
 * Eggs to the kitchen, against real Postgres (spec §4.3 "Connected apps").
 *
 * The promises that only a database can show: a write is sent once at each
 * version and never again; an edit or a tombstone is sent as a new version; a
 * failed send loses nothing and is retried on the next push; the egg history
 * from before the link is left alone; and nothing else is ever sent.
 *
 * `kitchen` below stands in for KitchenHub's endpoint with the same rule its
 * ledger keeps (functions/src/farm/farmEggs.js there): a version not newer
 * than the one held changes nothing. Its `stock` is what the fridge would say.
 */

const { afterFarmWrite, flushKitchenEggs, kitchenEggLink, pendingEggRecords } =
  await import("../lib/kitchen-egg-store.js");
const { applyPushAndMark } = await import("../lib/change-stamp.js");

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");
const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const LOG = "01ARZ3NDEKTSV4RRFFQ69G5E01" as Ulid;
const OLD_LOG = "01ARZ3NDEKTSV4RRFFQ69G5E00" as Ulid;
const GIVEN = "01ARZ3NDEKTSV4RRFFQ69G5D01" as Ulid;
const CONFIG: KitchenEggConfig = {
  endpoint: "https://kitchen.example.com/api/farm/eggs",
  token: "khapp_" + "t".repeat(43),
  propertyId: PROPERTY,
};

let client: PGlite;
let db: Database;
let clock = new Date("2026-11-25T12:00:00Z");
const tick = () => {
  clock = new Date(clock.getTime() + 60_000);
  return clock;
};

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await client.exec(statement);
    }
  }
  db = drizzle(client) as unknown as Database;
}, 60_000);

afterAll(async () => {
  await client.close();
});

/** A stand-in KitchenHub. */
function kitchen(options: { fail?: boolean } = {}) {
  const held = new Map<string, { v: number; n: number }>();
  const requests: KitchenEggRecord[][] = [];
  let stock = 0;
  let fail = options.fail ?? false;

  const contribution = (r: KitchenEggRecord) =>
    r.deleted ? 0 : r.type === "log" ? r.quantity : r.kind === "kept" ? 0 : -r.quantity;

  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(CONFIG.endpoint);
    expect((init?.headers as Record<string, string>)["authorization"]).toBe(
      `Bearer ${CONFIG.token}`,
    );
    if (fail) return new Response('{"error":"down"}', { status: 503 });
    const { records } = JSON.parse(String(init?.body)) as { records: KitchenEggRecord[] };
    requests.push(records);
    const applied: string[] = [];
    const unchanged: string[] = [];
    for (const record of records) {
      const version = Date.parse(record.version);
      const before = held.get(record.id);
      if (before && version <= before.v) {
        unchanged.push(record.id);
        continue;
      }
      const n = contribution(record);
      stock += n - (before?.n ?? 0);
      held.set(record.id, { v: version, n });
      applied.push(record.id);
    }
    return Response.json({
      ok: true,
      item: { id: "galaxyfarm-eggs", quantity: stock },
      applied,
      unchanged,
      ignored: [],
      rejected: [],
    });
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    get stock() {
      return stock;
    },
    set fail(value: boolean) {
      fail = value;
    },
  };
}

/** A write through the same door every server-side writer uses. */
async function write(
  entity: "eggLogs" | "eggDispositions",
  recordId: Ulid,
  before: Record<string, FieldValue>,
  after: Record<string, FieldValue>,
  propertyId: Ulid = PROPERTY,
): Promise<OutboxEntry[]> {
  const at = tick();
  const entries: OutboxEntry[] = [
    {
      id: `01ARZ3NDEKTSV4RRFFQ69G${String(at.getTime() % 10_000).padStart(4, "0")}` as Ulid,
      operation: Object.keys(before).length === 0 ? "create" : "update",
      patch: { entity, recordId, changes: diff(before, after, { at, deviceId: "test" }) },
      queuedAt: at,
      deviceId: "test",
      attempts: 0,
    },
  ];
  const result = await applyPush(db, entries, {
    propertyId,
    clock: { now: () => at },
    ids: { next: () => `01ARZ3NDEKTSV4RRFFQ69A${String(Math.random()).slice(2, 6)}` as Ulid },
  });
  expect(result.rejected).toEqual([]);
  return entries;
}

const collected = (total: number): Record<string, FieldValue> => ({
  collectedOn: new Date("2026-11-25T18:00:00Z"),
  total,
  breakdown: [],
});

const flush = (k: ReturnType<typeof kitchen>, propertyId: Ulid = PROPERTY) =>
  flushKitchenEggs(db, propertyId, { config: CONFIG, fetch: k.fetch, now: () => clock });

beforeEach(async () => {
  clock = new Date("2026-11-25T12:00:00Z");
  await client.exec(
    "truncate table properties, egg_logs, egg_dispositions, sync_field_meta, sync_audit, kitchen_egg_links, kitchen_egg_sends",
  );
  await repositoryFor<Property>(db, "properties").save({
    id: PROPERTY,
    propertyId: PROPERTY,
    createdAt: clock,
    updatedAt: clock,
    name: "Home place",
    timezone: "America/Chicago",
    latitude: 33.05,
    longitude: -97.44,
  } as Property);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sending eggs to the kitchen", () => {
  it("leaves the history from before the link alone", async () => {
    await write("eggLogs", OLD_LOG, {}, collected(30));
    await kitchenEggLink(db, PROPERTY, tick());
    await write("eggLogs", LOG, {}, collected(6));

    const k = kitchen();
    expect(await flush(k)).toEqual({ sent: 1, settled: 1 });
    expect(k.requests.flat().map((r) => r.id)).toEqual([LOG]);
    expect(k.stock).toBe(6);
  });

  it("sends a record once per version, so a repeated flush adds nothing", async () => {
    await kitchenEggLink(db, PROPERTY, clock);
    await write("eggLogs", LOG, {}, collected(6));
    const k = kitchen();

    await flush(k);
    expect(await flush(k)).toEqual({ sent: 0, settled: 0 });
    expect(k.requests).toHaveLength(1);
    expect(k.stock).toBe(6);
  });

  it("an edit, a disposition and a tombstone move the stock by the difference", async () => {
    await kitchenEggLink(db, PROPERTY, clock);
    const k = kitchen();

    await write("eggLogs", LOG, {}, collected(6));
    await flush(k);
    await write("eggLogs", LOG, collected(6), collected(9));
    await flush(k);
    expect(k.stock).toBe(9);

    await write(
      "eggDispositions",
      GIVEN,
      {},
      { disposedOn: new Date("2026-11-25T18:00:00Z"), quantity: 4, kind: "given" },
    );
    await flush(k);
    expect(k.stock).toBe(5);

    await write("eggLogs", LOG, collected(9), { ...collected(9), deletedAt: tick() });
    await flush(k);
    expect(k.stock).toBe(-4);
    expect(k.requests.at(-1)).toEqual([expect.objectContaining({ id: LOG, deleted: true })]);
  });

  it("a failed send loses nothing: the record waits, and the next push retries it", async () => {
    await kitchenEggLink(db, PROPERTY, clock);
    const k = kitchen({ fail: true });
    await write("eggLogs", LOG, {}, collected(6));

    const failed = await flush(k);
    expect(failed?.error).toMatch(/503/);
    expect(failed?.error).not.toContain(CONFIG.token);
    expect(await pendingEggRecords(db, PROPERTY, new Date(0))).toHaveLength(1);
    const [link] = await db.select().from(kitchenEggLinks);
    expect(link?.lastError).toMatch(/503/);

    // A push that has nothing to do with eggs is the next chance to retry.
    k.fail = false;
    const unrelated = [
      { patch: { entity: "animals", recordId: "01X" as Ulid, changes: [] } },
    ] as unknown as OutboxEntry[];
    await afterFarmWrite(db, PROPERTY, unrelated, { config: CONFIG, fetch: k.fetch });
    expect(k.stock).toBe(6);
    const [after] = await db.select().from(kitchenEggLinks);
    expect(after?.lastError).toBeNull();

    // And once healthy, an unrelated push costs no request at all.
    await afterFarmWrite(db, PROPERTY, unrelated, { config: CONFIG, fetch: k.fetch });
    expect(k.requests).toHaveLength(1);
  });

  it("never moves an acknowledged version backwards", async () => {
    await kitchenEggLink(db, PROPERTY, clock);
    await write("eggLogs", LOG, {}, collected(6));
    const k = kitchen();
    await flush(k);
    const [row] = await db.select().from(kitchenEggSends);

    const { markEggsSent } = await import("../lib/kitchen-egg-store.js");
    await markEggsSent(
      db,
      PROPERTY,
      [
        {
          entity: "eggLogs",
          id: LOG,
          updatedAt: new Date(0),
          deletedAt: null,
          on: clock,
          quantity: 6,
          kind: null,
        },
      ],
      clock,
    );
    const [again] = await db.select().from(kitchenEggSends);
    expect(again?.version).toEqual(row?.version);
  });

  it("sends nothing for a property the kitchen is not linked to, or with no config", async () => {
    const k = kitchen();
    expect(await flush(k, OTHER)).toBeUndefined();
    expect(
      await flushKitchenEggs(db, PROPERTY, { config: undefined, fetch: k.fetch }),
    ).toBeUndefined();
    expect(await afterFarmWrite(db, PROPERTY, [], { config: undefined })).toBeUndefined();
    expect(k.fetch).not.toHaveBeenCalled();
  });

  it("goes out from applyPushAndMark itself, after the write, for whoever wrote it", async () => {
    vi.stubEnv("KITCHENHUB_URL", "https://kitchen.example.com");
    vi.stubEnv("KITCHENHUB_TOKEN", CONFIG.token);
    vi.stubEnv("KITCHENHUB_PROPERTY_ID", PROPERTY);
    await kitchenEggLink(db, PROPERTY, clock);
    const k = kitchen();
    vi.stubGlobal("fetch", k.fetch);

    const at = tick();
    const result = await applyPushAndMark(
      db,
      [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5Q01" as Ulid,
          operation: "create",
          patch: {
            entity: "eggLogs",
            recordId: LOG,
            changes: diff({}, collected(12), { at, deviceId: "kiosk" }),
          },
          queuedAt: at,
          deviceId: "kiosk",
          attempts: 0,
        },
      ],
      {
        propertyId: PROPERTY,
        clock: { now: () => at },
        ids: { next: () => "01ARZ3NDEKTSV4RRFFQ69G5Q02" as Ulid },
      },
    );
    expect(result.accepted).toHaveLength(1);
    expect(k.stock).toBe(12);
  });

  it("a kitchen that is down never fails the farm write", async () => {
    vi.stubEnv("KITCHENHUB_URL", "https://kitchen.example.com");
    vi.stubEnv("KITCHENHUB_TOKEN", CONFIG.token);
    vi.stubEnv("KITCHENHUB_PROPERTY_ID", PROPERTY);
    await kitchenEggLink(db, PROPERTY, clock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const at = tick();
    const result = await applyPushAndMark(
      db,
      [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5Q03" as Ulid,
          operation: "create",
          patch: {
            entity: "eggLogs",
            recordId: LOG,
            changes: diff({}, collected(3), { at, deviceId: "kiosk" }),
          },
          queuedAt: at,
          deviceId: "kiosk",
          attempts: 0,
        },
      ],
      {
        propertyId: PROPERTY,
        clock: { now: () => at },
        ids: { next: () => "01ARZ3NDEKTSV4RRFFQ69G5Q04" as Ulid },
      },
    );
    expect(result.accepted).toHaveLength(1);
    expect(await pendingEggRecords(db, PROPERTY, new Date(0))).toHaveLength(1);
    const [link] = await db.select().from(kitchenEggLinks);
    expect(link?.lastError).toMatch(/fetch failed/);
  });
});
