import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import type { Database } from "@galaxy-farm/infra-db";

import { clearKioskPin, hasKioskPin, setKioskPin, verifyKioskPin } from "../lib/kiosk-pin-store.js";

/**
 * The shared kiosk PIN (spec §4.3, §4.4, §4.5 tier "Elevated").
 *
 * Against real Postgres for the same reason `device-store.test.ts` is: the
 * property under test is whether a hash written by one call is the hash a
 * later call actually reads back and verifies against.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER_PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const NOW = new Date("2026-06-15T12:00:00Z");

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
  await client.exec("truncate table kiosk_pins");
});

describe("no PIN set", () => {
  it("reports unset, and verifies nothing", async () => {
    expect(await hasKioskPin(PROPERTY, db)).toBe(false);
    expect(await verifyKioskPin(PROPERTY, "1234", db)).toBe(false);
  });
});

describe("setKioskPin", () => {
  it("can be verified afterward, and a wrong guess fails", async () => {
    await setKioskPin(PROPERTY, "4242", NOW, db);

    expect(await hasKioskPin(PROPERTY, db)).toBe(true);
    expect(await verifyKioskPin(PROPERTY, "4242", db)).toBe(true);
    expect(await verifyKioskPin(PROPERTY, "0000", db)).toBe(false);
  });

  it("never lets an empty guess pass, however the row is stored", async () => {
    await setKioskPin(PROPERTY, "4242", NOW, db);
    expect(await verifyKioskPin(PROPERTY, "", db)).toBe(false);
  });

  it("is scoped to one property", async () => {
    await setKioskPin(PROPERTY, "4242", NOW, db);
    expect(await hasKioskPin(OTHER_PROPERTY, db)).toBe(false);
    expect(await verifyKioskPin(OTHER_PROPERTY, "4242", db)).toBe(false);
  });

  it("replaces an earlier PIN rather than keeping both live", async () => {
    await setKioskPin(PROPERTY, "4242", NOW, db);
    await setKioskPin(PROPERTY, "1357", NOW, db);

    expect(await verifyKioskPin(PROPERTY, "4242", db)).toBe(false);
    expect(await verifyKioskPin(PROPERTY, "1357", db)).toBe(true);
  });
});

describe("clearKioskPin", () => {
  it("turns the gate back off", async () => {
    await setKioskPin(PROPERTY, "4242", NOW, db);
    await clearKioskPin(PROPERTY, NOW, db);

    expect(await hasKioskPin(PROPERTY, db)).toBe(false);
    expect(await verifyKioskPin(PROPERTY, "4242", db)).toBe(false);
  });
});
