import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChoreTemplate, Property, Task, Ulid } from "@galaxy-farm/core";
import { hashApiToken } from "@galaxy-farm/infra-auth";
import { apiTokens, repositoryFor, syncFieldMeta, type Database } from "@galaxy-farm/infra-db";

/**
 * The board API against real Postgres (spec §4.3 "Connected apps").
 *
 * Three things only a database can say: that a token is found by its hash and
 * stops working the moment it is revoked; that the token reaches its own
 * property and no other; and that a tick lands the way a kiosk's does —
 * through the push path, attributed to the app, with the change stamp bumped
 * so every screen's next pull picks it up.
 */

const marked = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/change-stamp", async () => {
  const { applyPush } = await import("@galaxy-farm/infra-db");
  return {
    applyPushAndMark: async (...args: Parameters<typeof applyPush>) => {
      const result = await applyPush(...args);
      if (result.accepted.length > 0) marked.push(args[2].propertyId);
      return result;
    },
    markChanged: async (propertyId: string) => {
      marked.push(propertyId);
    },
    currentStamp: async () => undefined,
  };
});

const { authenticateApiToken, apiTokenDeviceId, createApiToken, listApiTokens, revokeApiToken } =
  await import("../lib/api-token-store.js");
const { authorizeBoardRequest, boardSnapshot, tickBoardChore } =
  await import("../lib/board-store.js");

const MIGRATIONS_DIR = join(process.cwd(), "packages/infrastructure/db/migrations");

const PROPERTY = "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid;
const OTHER = "01ARZ3NDEKTSV4RRFFQ69G5FP2" as Ulid;
const OWNER = "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid;
const TEMPLATE = "01ARZ3NDEKTSV4RRFFQ69G5FT1" as Ulid;
/** 21:00 on Monday 16 November in Texas — already Tuesday in UTC. */
const NOW = new Date("2026-11-17T03:00:00Z");
const MADE = new Date("2026-11-01T12:00:00Z");

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
  marked.length = 0;
  await client.exec(
    "truncate table api_tokens, properties, chore_templates, tasks, sync_field_meta, sync_audit",
  );
  await repositoryFor<Property>(db, "properties").save({
    id: PROPERTY,
    propertyId: PROPERTY,
    createdAt: MADE,
    updatedAt: MADE,
    name: "Home place",
    timezone: "America/Chicago",
    latitude: 33.05,
    longitude: -97.44,
  } as Property);
  await repositoryFor<ChoreTemplate>(db, "choreTemplates").save({
    id: TEMPLATE,
    propertyId: PROPERTY,
    createdAt: MADE,
    updatedAt: MADE,
    title: "Shut the coop",
    recurrence: "daily",
    recurrenceDays: [],
    timeOfDay: "evening",
    active: true,
  } as ChoreTemplate);
});

const mint = (propertyId: Ulid = PROPERTY) =>
  createApiToken({ propertyId, label: "Fridge Board", createdBy: OWNER }, MADE, db);

describe("api tokens", () => {
  it("keeps only the hash, and finds the row by the token", async () => {
    const { apiToken, token } = await mint();

    const [row] = await db.select().from(apiTokens);
    expect(row?.tokenHash).toBe(hashApiToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(apiToken)).not.toContain(row!.tokenHash);

    const found = await authenticateApiToken(token, NOW, db);
    expect(found).toMatchObject({ id: apiToken.id, propertyId: PROPERTY, lastUsedAt: NOW });
    expect(await authenticateApiToken(`${token}x`, NOW, db)).toBeUndefined();
    expect(await authenticateApiToken("", NOW, db)).toBeUndefined();
  });

  it("stops working the moment it is revoked, and stays listed as revoked", async () => {
    const { apiToken, token } = await mint();
    await revokeApiToken(apiToken.id, NOW, db);

    expect(await authenticateApiToken(token, NOW, db)).toBeUndefined();
    const [listed] = await listApiTokens(PROPERTY, db);
    expect(listed?.revokedAt).toEqual(NOW);
    expect(await listApiTokens(OTHER, db)).toEqual([]);
  });

  it("reads the bearer header and nothing else", async () => {
    const { token } = await mint();
    const lookup = (value: string, now: Date) => authenticateApiToken(value, now, db);

    expect(await authorizeBoardRequest(`Bearer ${token}`, NOW, lookup)).toBeDefined();
    expect(await authorizeBoardRequest(null, NOW, lookup)).toBeUndefined();
    expect(await authorizeBoardRequest(token, NOW, lookup)).toBeUndefined();
    expect(await authorizeBoardRequest(`Basic ${token}`, NOW, lookup)).toBeUndefined();
  });
});

describe("the board", () => {
  it("answers in the farm's day, for the token's property", async () => {
    const { apiToken } = await mint();
    const board = await boardSnapshot(apiToken, NOW, db);

    expect(board.property).toEqual({
      name: "Home place",
      lat: 33.05,
      lon: -97.44,
      timezone: "America/Chicago",
    });
    expect(board.date).toBe("2026-11-16");
    expect(board.chores).toEqual([
      {
        id: `occurrence:${TEMPLATE}:2026-11-16`,
        title: "Shut the coop",
        detail: null,
        slot: "evening",
        done: false,
      },
    ]);
    expect(board.sitter).toEqual({ contacts: [], notes: [] });

    const { apiToken: elsewhere } = await mint(OTHER);
    expect((await boardSnapshot(elsewhere, NOW, db)).chores).toEqual([]);
  });

  it("ticks a chore the way the kiosk does, attributed to the app", async () => {
    const { apiToken } = await mint();
    const id = `occurrence:${TEMPLATE}:2026-11-16`;

    expect(await tickBoardChore(apiToken, id, true, NOW, db)).toEqual({
      kind: "ticked",
      done: true,
    });

    const [row] = await repositoryFor<Task>(db, "tasks").list({ propertyId: PROPERTY });
    expect(row).toMatchObject({ templateId: TEMPLATE, completedBy: apiToken.id });
    const meta = await db.select().from(syncFieldMeta);
    expect(new Set(meta.map((m) => m.writtenBy))).toEqual(new Set([apiTokenDeviceId(apiToken)]));
    expect(marked).toEqual([PROPERTY]);

    const board = await boardSnapshot(apiToken, NOW, db);
    expect(board.chores).toEqual([expect.objectContaining({ id: row!.id, done: true })]);

    // Un-ticked a minute later with the id the caller already had, which the
    // row has since replaced.
    const later = new Date(NOW.getTime() + 60_000);
    expect(await tickBoardChore(apiToken, id, false, later, db)).toEqual({
      kind: "ticked",
      done: false,
    });
    expect((await boardSnapshot(apiToken, later, db)).chores[0]?.done).toBe(false);
  });

  it("refuses an id today's sheet does not show, and another property's chores", async () => {
    const { apiToken } = await mint();
    const { apiToken: elsewhere } = await mint(OTHER);

    expect(await tickBoardChore(apiToken, "nonsense", true, NOW, db)).toEqual({
      kind: "not_found",
    });
    expect(
      await tickBoardChore(elsewhere, `occurrence:${TEMPLATE}:2026-11-16`, true, NOW, db),
    ).toEqual({ kind: "not_found" });
    expect(await repositoryFor<Task>(db, "tasks").list({ propertyId: PROPERTY })).toEqual([]);
  });

  it("treats un-ticking a chore nobody wrote down as already true", async () => {
    const { apiToken } = await mint();
    expect(
      await tickBoardChore(apiToken, `occurrence:${TEMPLATE}:2026-11-16`, false, NOW, db),
    ).toEqual({ kind: "ticked", done: false });
    expect(marked).toEqual([]);
  });
});
