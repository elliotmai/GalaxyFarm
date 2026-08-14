import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import type { Database } from "@galaxy-farm/infra-db";

import {
  authenticateDevice,
  createDevice,
  findDevice,
  isDeviceLive,
  isPaired,
  isRevoked,
  listDevices,
  lockDeviceToBoard,
  redeemPairing,
  reissuePairing,
  renameDevice,
  revokeDevice,
} from "../lib/device-store.js";

/**
 * Paired barn screens, against real Postgres (spec §4.1, §4.4).
 *
 * PGlite, the same as `sitter-store.test.ts` — the property that matters is
 * whether a lookup by hash actually finds the row Postgres holds, which a
 * mock cannot tell you anything about.
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
  await client.exec("truncate table kiosk_devices");
});

describe("createDevice", () => {
  it("mints a live pairing code and no token yet", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);

    expect(device.name).toBe("Barn TV");
    expect(device.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(device.pairingExpiresAt).toBeInstanceOf(Date);
    expect(isPaired(device)).toBe(false);
    expect(isRevoked(device)).toBe(false);
  });

  it("trims the name", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "  Coop tablet  " }, NOW, db);
    expect(device.name).toBe("Coop tablet");
  });
});

describe("redeemPairing", () => {
  it("turns a live code into a token, and the device is paired afterward", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);

    const redeemed = await redeemPairing(device.pairingCode!, NOW, db);

    expect(redeemed).toBeDefined();
    expect(redeemed!.token.length).toBeGreaterThanOrEqual(43);
    expect(isPaired(redeemed!.device)).toBe(true);
    expect(redeemed!.device.pairingCode).toBeUndefined();
  });

  it("is case- and space-insensitive, since a code is read aloud as often as typed", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const lower = device.pairingCode!.toLowerCase();

    const redeemed = await redeemPairing(` ${lower} `, NOW, db);
    expect(redeemed).toBeDefined();
  });

  it("is single-use — the same code cannot be redeemed twice", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const code = device.pairingCode!;

    await redeemPairing(code, NOW, db);
    const second = await redeemPairing(code, NOW, db);

    expect(second).toBeUndefined();
  });

  it("refuses a code once it has expired", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const later = new Date(device.pairingExpiresAt!.getTime() + 1);

    const redeemed = await redeemPairing(device.pairingCode!, later, db);
    expect(redeemed).toBeUndefined();
  });

  it("refuses a code that never existed", async () => {
    const redeemed = await redeemPairing("ZZZZZZ", NOW, db);
    expect(redeemed).toBeUndefined();
  });

  it("refuses a code belonging to a revoked device", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    await revokeDevice(device.id, NOW, db);

    const redeemed = await redeemPairing(device.pairingCode!, NOW, db);
    expect(redeemed).toBeUndefined();
  });
});

describe("authenticateDevice", () => {
  it("finds the device that token was minted for, and touches lastSeenAt", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const { token } = (await redeemPairing(device.pairingCode!, NOW, db))!;

    const later = new Date(NOW.getTime() + 60_000);
    const found = await authenticateDevice(token, later, db);

    expect(found?.id).toBe(device.id);
    expect(found?.lastSeenAt?.getTime()).toBe(later.getTime());
  });

  it("refuses an unknown token", async () => {
    const found = await authenticateDevice("not-a-real-token", NOW, db);
    expect(found).toBeUndefined();
  });

  it("refuses an empty token without querying the database for it", async () => {
    const found = await authenticateDevice("", NOW, db);
    expect(found).toBeUndefined();
  });

  it("refuses a token belonging to a revoked device", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const { token } = (await redeemPairing(device.pairingCode!, NOW, db))!;
    await revokeDevice(device.id, NOW, db);

    const found = await authenticateDevice(token, NOW, db);
    expect(found).toBeUndefined();
  });
});

describe("reissuePairing", () => {
  it("invalidates the old token and issues a fresh code", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    const { token: oldToken } = (await redeemPairing(device.pairingCode!, NOW, db))!;

    const reissued = await reissuePairing(device.id, NOW, db);

    expect(reissued?.pairingCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(isPaired(reissued!)).toBe(false);
    expect(await authenticateDevice(oldToken, NOW, db)).toBeUndefined();
  });
});

describe("revokeDevice / isDeviceLive", () => {
  it("is live once created, and not live once revoked", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    expect(await isDeviceLive(device.id, PROPERTY, db)).toBe(true);

    await revokeDevice(device.id, NOW, db);
    const revoked = await findDevice(device.id, db);

    expect(isRevoked(revoked!)).toBe(true);
    expect(await isDeviceLive(device.id, PROPERTY, db)).toBe(false);
  });

  it("is not live for a device that belongs to a different property", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    expect(await isDeviceLive(device.id, OTHER_PROPERTY, db)).toBe(false);
  });
});

describe("rename / lock to board", () => {
  it("renames a device", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    await renameDevice(device.id, "Coop tablet", NOW, db);

    expect((await findDevice(device.id, db))?.name).toBe("Coop tablet");
  });

  it("locks to a board, and unlocks with null", async () => {
    const device = await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);

    await lockDeviceToBoard(device.id, "pen-board", NOW, db);
    expect((await findDevice(device.id, db))?.lockedToBoard).toBe("pen-board");

    await lockDeviceToBoard(device.id, null, NOW, db);
    expect((await findDevice(device.id, db))?.lockedToBoard).toBeUndefined();
  });
});

describe("listDevices", () => {
  it("lists only the requesting property's devices, by name", async () => {
    await createDevice({ propertyId: PROPERTY, name: "Coop tablet" }, NOW, db);
    await createDevice({ propertyId: PROPERTY, name: "Barn TV" }, NOW, db);
    await createDevice({ propertyId: OTHER_PROPERTY, name: "Someone else's screen" }, NOW, db);

    const devices = await listDevices(PROPERTY, db);

    expect(devices.map((d) => d.name)).toEqual(["Barn TV", "Coop tablet"]);
  });
});
