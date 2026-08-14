import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";
import { allTables, type Database } from "@galaxy-farm/infra-db";

import { farmName } from "../lib/farm-name.js";

/**
 * The farm name, server-side (spec §5.1).
 *
 * §5.1's rule is that the name is a stored value with an env-var fallback, and
 * the property worth testing is the resolution *order* — an email that says
 * "Flying Double M" when the farm has been renamed in settings is exactly the
 * failure the rule exists to prevent.
 *
 * Against a real Postgres, like `user-store.test.ts` beside it: the tie-break
 * between two branding rows is done in `resolveBranding` but the rows come
 * from a query with a `deletedAt` clause, and a fake store would test neither.
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
  await client.exec("truncate table branding_configs");
});

async function store(
  id: string,
  name: string,
  overrides: { propertyId?: Ulid; deletedAt?: Date } = {},
) {
  await db.insert(allTables.brandingConfigs).values({
    id,
    propertyId: overrides.propertyId ?? PROPERTY,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: overrides.deletedAt ?? null,
    farmName: name,
  } as never);
}

describe("farmName", () => {
  it("prefers the stored name over the environment", async () => {
    await store("01ARZ3NDEKTSV4RRFFQ69G5FB1", "Rocking M Cattle");

    expect(await farmName(PROPERTY, db, { NEXT_PUBLIC_FARM_NAME: "Env Name" })).toBe(
      "Rocking M Cattle",
    );
  });

  it("falls back to the environment when nothing is stored", async () => {
    expect(await farmName(PROPERTY, db, { NEXT_PUBLIC_FARM_NAME: "Env Name" })).toBe("Env Name");
  });

  it("falls back again to the neutral default", async () => {
    expect(await farmName(PROPERTY, db, {})).toBe("Flying Double M");
  });

  it("ignores a deleted config", async () => {
    await store("01ARZ3NDEKTSV4RRFFQ69G5FB1", "Old Name", { deletedAt: NOW });

    expect(await farmName(PROPERTY, db, { NEXT_PUBLIC_FARM_NAME: "Env Name" })).toBe("Env Name");
  });

  it("ignores another property's name", async () => {
    await store("01ARZ3NDEKTSV4RRFFQ69G5FB1", "Somebody Else's Farm", {
      propertyId: OTHER_PROPERTY,
    });

    expect(await farmName(PROPERTY, db, { NEXT_PUBLIC_FARM_NAME: "Env Name" })).toBe("Env Name");
  });

  it("breaks a tie by id, the way every screen already does", async () => {
    // Two devices that each named the farm while offline both produce a row.
    // The server has to reach the same answer the nav reaches, or an email
    // disagrees with the page that sent it.
    await store("01ARZ3NDEKTSV4RRFFQ69G5FB2", "Second");
    await store("01ARZ3NDEKTSV4RRFFQ69G5FB1", "First");

    expect(await farmName(PROPERTY, db, {})).toBe("First");
  });

  it("uses the fallback rather than throwing when the database will not answer", async () => {
    // The name is decoration on every caller. An email that failed to send
    // because Neon was asleep when somebody asked what the farm is called is
    // the worse outcome, so this degrades instead.
    const broken = {
      select: () => {
        throw new Error("connection terminated unexpectedly");
      },
    } as unknown as Database;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await farmName(PROPERTY, broken, { NEXT_PUBLIC_FARM_NAME: "Env Name" })).toBe(
        "Env Name",
      );
      // Reported somewhere, or it can only be diagnosed by reproducing it.
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
