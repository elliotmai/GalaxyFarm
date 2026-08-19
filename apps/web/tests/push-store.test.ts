import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import { users, type Database } from "@galaxy-farm/infra-db";

import {
  deleteDevice,
  deviceIdForEndpoint,
  forgetEndpoint,
  forgetEndpointFor,
  listDevices,
  saveSubscription,
  subscriptionsFor,
  subscriptionsForEmail,
} from "../lib/push-store.js";

/**
 * Push subscriptions (spec §6).
 *
 * Against real Postgres, like every other store test here, because the
 * properties worth asserting are properties of the rows: that a second
 * subscription from the same browser replaces the first rather than doubling
 * it, and that revoking one device leaves the others alone.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const SAM = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const ALEX = "01ARZ3NDEKTSV4RRFFQ69G5FU2" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");
const LATER = new Date("2026-06-15T12:05:00Z");

/** Realistic sizes, so the store is exercised with what a browser actually gives. */
const KEYS = { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: "0123456789abcdef" };

const PHONE = "https://fcm.googleapis.com/fcm/send/phone";
const LAPTOP = "https://updates.push.services.mozilla.com/wpush/v2/laptop";

let client: PGlite;
let db: Database;

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

beforeEach(async () => {
  await client.exec("truncate table push_subscriptions");
  await client.exec("truncate table users");

  await db.insert(users).values([
    {
      id: SAM,
      propertyId: PROPERTY,
      createdAt: NOW,
      updatedAt: NOW,
      name: "Sam",
      email: "sam@example.invalid",
      role: "owner",
      active: true,
    },
    {
      id: ALEX,
      propertyId: PROPERTY,
      createdAt: NOW,
      updatedAt: NOW,
      name: "Alex",
      email: "alex@example.invalid",
      role: "member",
      active: true,
    },
  ] as never);
});

const subscribe = (userId: Ulid, endpoint: string, deviceLabel: string, at = NOW) =>
  saveSubscription({ propertyId: PROPERTY, userId, endpoint, ...KEYS, deviceLabel }, at, db);

describe("saveSubscription", () => {
  it("stores one row per browser", async () => {
    await subscribe(SAM, PHONE, "iPhone");
    await subscribe(SAM, LAPTOP, "Mac", LATER);

    expect((await listDevices(SAM, db)).map((device) => device.deviceLabel)).toEqual([
      "iPhone",
      "Mac",
    ]);
  });

  it("updates the browser's existing row rather than adding a second", async () => {
    // A renewed subscription arrives with the same endpoint and fresh keys.
    // Inserting it would send every notification to this phone twice, once
    // against keys that no longer work.
    await subscribe(SAM, PHONE, "iPhone");
    await saveSubscription(
      {
        propertyId: PROPERTY,
        userId: SAM,
        endpoint: PHONE,
        p256dh: Buffer.alloc(65, 9).toString("base64url"),
        auth: "fedcba9876543210",
        deviceLabel: "iPhone 17",
      },
      LATER,
      db,
    );

    const devices = await listDevices(SAM, db);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceLabel).toBe("iPhone 17");
    expect((await subscriptionsFor(SAM, db))[0]?.keys.auth).toBe("fedcba9876543210");
  });

  it("hands a shared device to whoever signed in last", async () => {
    // The kitchen laptop, used by both. Leaving it on the first person would
    // push their alerts to somebody else's browser session.
    await subscribe(SAM, LAPTOP, "Mac");
    await subscribe(ALEX, LAPTOP, "Mac", LATER);

    expect(await listDevices(SAM, db)).toEqual([]);
    expect(await listDevices(ALEX, db)).toHaveLength(1);
  });
});

describe("listDevices", () => {
  it("shows only the asker's own devices", async () => {
    await subscribe(SAM, PHONE, "iPhone");
    await subscribe(ALEX, LAPTOP, "Mac");

    expect(await listDevices(SAM, db)).toHaveLength(1);
  });

  it("never hands over the keys", async () => {
    await subscribe(SAM, PHONE, "iPhone");

    expect(JSON.stringify(await listDevices(SAM, db))).not.toContain(KEYS.auth);
  });
});

describe("subscriptionsFor", () => {
  it("returns every device with the keys the notifier needs", async () => {
    await subscribe(SAM, PHONE, "iPhone");
    await subscribe(SAM, LAPTOP, "Mac", LATER);

    expect(await subscriptionsFor(SAM, db)).toEqual([
      { endpoint: PHONE, keys: KEYS },
      { endpoint: LAPTOP, keys: KEYS },
    ]);
  });
});

describe("subscriptionsForEmail", () => {
  it("finds the person behind the address a message names", async () => {
    await subscribe(SAM, PHONE, "iPhone");

    expect(await subscriptionsForEmail("sam@example.invalid", db)).toHaveLength(1);
  });

  it("matches an address however it was typed", async () => {
    await subscribe(SAM, PHONE, "iPhone");

    expect(await subscriptionsForEmail("  Sam@Example.Invalid ", db)).toHaveLength(1);
  });

  it("is empty for an address nobody on the farm holds", async () => {
    // A vet, a contact, a typo. Not an error: a notifier is not the place to
    // discover that an address is out of date.
    expect(await subscriptionsForEmail("nobody@example.invalid", db)).toEqual([]);
  });
});

describe("revoking", () => {
  it("silences one device and leaves the others alone", async () => {
    // The §6 promise this table's shape exists for.
    await subscribe(SAM, PHONE, "iPhone");
    await subscribe(SAM, LAPTOP, "Mac", LATER);

    const phone = (await listDevices(SAM, db)).find((device) => device.deviceLabel === "iPhone");
    expect(await deleteDevice(phone?.id as Ulid, SAM, db)).toBe(true);

    expect((await subscriptionsFor(SAM, db)).map((s) => s.endpoint)).toEqual([LAPTOP]);
  });

  it("refuses to revoke somebody else's device", async () => {
    await subscribe(ALEX, LAPTOP, "Mac");
    const [device] = await listDevices(ALEX, db);

    expect(await deleteDevice(device?.id as Ulid, SAM, db)).toBe(false);
    expect(await listDevices(ALEX, db)).toHaveLength(1);
  });

  it("forgets an endpoint the browser unsubscribed, scoped to its owner", async () => {
    await subscribe(SAM, PHONE, "iPhone");
    await subscribe(ALEX, LAPTOP, "Mac");

    await forgetEndpointFor(LAPTOP, SAM, db);
    expect(await listDevices(ALEX, db)).toHaveLength(1);

    await forgetEndpointFor(PHONE, SAM, db);
    expect(await listDevices(SAM, db)).toEqual([]);
  });

  it("prunes an endpoint a push service says is gone, whoever it belonged to", async () => {
    // The notifier's own path: there is no actor to scope by, and a 410 is
    // final regardless of whose device it was.
    await subscribe(ALEX, LAPTOP, "Mac");

    await forgetEndpoint(LAPTOP, db);

    expect(await listDevices(ALEX, db)).toEqual([]);
  });
});

describe("deviceIdForEndpoint", () => {
  it("tells a browser which row in the list is itself", async () => {
    await subscribe(SAM, PHONE, "iPhone");
    const [device] = await listDevices(SAM, db);

    expect(await deviceIdForEndpoint(PHONE, SAM, db)).toBe(device?.id);
  });

  it("says nothing about an endpoint that is not the asker's", async () => {
    await subscribe(ALEX, LAPTOP, "Mac");

    expect(await deviceIdForEndpoint(LAPTOP, SAM, db)).toBeUndefined();
  });
});
