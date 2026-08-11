import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fixedClock, type Ulid } from "@galaxy-farm/core";
import { hashPassword, signIn } from "@galaxy-farm/infra-auth";
import { users, type Database } from "@galaxy-farm/infra-db";

import { credentialStore } from "../lib/credential-store.js";

/**
 * Sign-in, end to end, against a real Postgres.
 *
 * The three pieces this exercises are deliberately kept apart: `infra-auth`
 * knows about passwords and nothing about Postgres, `infra-db` knows about
 * Postgres and nothing about passwords, and the app joins them. That
 * separation is what §4.1 asks for, and it means nothing has ever run the
 * whole path until here — which is exactly where a null-versus-undefined or a
 * mistyped column would hide.
 */

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const NOW = new Date("2026-11-15T12:00:00Z");
const clock = fixedClock(NOW);

/** Weak on purpose: these tests are about the wiring, not the cost parameters. */
const FAST = { N: 1_024, r: 8, p: 1, keyLength: 64 } as const;

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
  await client.exec("truncate table users");
});

async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    id: USER,
    propertyId: PROPERTY,
    createdAt: NOW,
    updatedAt: NOW,
    email: "eli@example.com",
    name: "Eli",
    role: "owner",
    passwordHash: await hashPassword("hunter2", FAST),
    active: true,
    ...overrides,
  });
}

describe("credentialStore", () => {
  it("finds a user and lets the right password through", async () => {
    await insertUser();

    const result = await signIn(
      credentialStore(db),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.id).toBe(USER);
      expect(result.actor.role).toBe("owner");
      expect(result.actor.propertyId).toBe(PROPERTY);
    }
  }, 30_000);

  it("turns null columns into absent fields, not into nulls", async () => {
    // `accessFrom: null` in a row must not become `accessFrom: null` on the
    // entity — `isWithinAccessWindow` checks for undefined, and a null there
    // would lock an owner out of their own farm.
    await insertUser();

    const found = await credentialStore(db).findByEmail("eli@example.com");

    expect(found?.user.accessFrom).toBeUndefined();
    expect("deletedAt" in (found?.user ?? {})).toBe(false);
  }, 30_000);

  it("carries a housesitter's window through from the row", async () => {
    await insertUser({
      role: "housesitter",
      accessFrom: new Date("2026-11-10T00:00:00Z"),
      accessTo: new Date("2026-11-20T00:00:00Z"),
    });

    const result = await signIn(
      credentialStore(db),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actor.accessWindow).toEqual({
        from: new Date("2026-11-10T00:00:00Z"),
        to: new Date("2026-11-20T00:00:00Z"),
      });
    }
  }, 30_000);

  it("does not find a soft-deleted account at all", async () => {
    // Filtered in the query as well as in `signIn`, so a tombstoned account is
    // unreachable even if that second check is ever moved.
    await insertUser({ deletedAt: NOW, deletedBy: USER });

    expect(await credentialStore(db).findByEmail("eli@example.com")).toBeUndefined();
  }, 30_000);

  it("refuses a deactivated account", async () => {
    await insertUser({ active: false });

    const result = await signIn(
      credentialStore(db),
      { email: "eli@example.com", password: "hunter2" },
      clock,
    );

    expect(result).toEqual({ ok: false, failure: { kind: "invalid-credentials" } });
  }, 30_000);

  it("returns nothing for an address it has never seen", async () => {
    expect(await credentialStore(db).findByEmail("nobody@example.com")).toBeUndefined();
  }, 30_000);

  it("upgrades a weak hash in the database, at the one moment it can", async () => {
    // The row was written with FAST parameters; signing in re-hashes it at the
    // current cost and stores that, so raising the cost costs nobody a reset.
    await insertUser();

    await signIn(credentialStore(db), { email: "eli@example.com", password: "hunter2" }, clock);

    const [row] = await db.select().from(users).where(eq(users.id, USER));
    expect(row?.passwordHash).toMatch(/^scrypt\$65536\$/);
  }, 60_000);

  it("records the sign-in without calling it an edit to the record", async () => {
    // `updatedAt` means "the record changed". Signing in is not a change to
    // the record, and treating it as one would make every sign-in look like an
    // edit in the history.
    //
    // Hashed at full strength on purpose: a weak hash would be upgraded on
    // sign-in, and that *is* a change to the row, which would mask what is
    // being asserted here.
    await insertUser({ passwordHash: await hashPassword("hunter2") });

    await signIn(credentialStore(db), { email: "eli@example.com", password: "hunter2" }, clock);

    const [row] = await db.select().from(users).where(eq(users.id, USER));
    expect(row?.lastSignedInAt).toEqual(NOW);
    expect(row?.updatedAt).toEqual(NOW);
  }, 60_000);

  it("does treat a password rehash as an edit", async () => {
    // The other side of the same coin. The stored hash genuinely changed, so
    // the row genuinely changed.
    await insertUser();

    await signIn(credentialStore(db), { email: "eli@example.com", password: "hunter2" }, clock);

    const [row] = await db.select().from(users).where(eq(users.id, USER));
    expect(row?.updatedAt).toEqual(NOW);
    expect(row?.passwordHash).toMatch(/^scrypt\$65536\$/);
  }, 60_000);
});
