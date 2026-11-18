import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ulid } from "@galaxy-farm/core";

/**
 * `/api/board/v1` and `/api/board/v1/chores/{id}` (spec §4.3 "Connected
 * apps") — the HTTP contract the Fridge Board is written against. The store
 * behind it is tested against Postgres in `board-store.test.ts`; this holds
 * the status codes and bodies.
 */

const TOKEN = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FX1" as Ulid,
  propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FP1" as Ulid,
  label: "Fridge Board",
  createdAt: new Date("2026-11-01T12:00:00Z"),
  createdBy: "01ARZ3NDEKTSV4RRFFQ69G5FU1" as Ulid,
};

const state = vi.hoisted(() => ({
  authorized: true,
  authFails: false,
  tick: { kind: "ticked", done: true } as
    { kind: "ticked"; done: boolean } | { kind: "not_found" } | { kind: "refused"; reason: string },
  ticks: [] as { id: string; done: boolean }[],
  headers: [] as (string | null)[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/board-store", () => ({
  authorizeBoardRequest: async (header: string | null) => {
    state.headers.push(header);
    if (state.authFails) throw new Error("database asleep");
    return state.authorized ? TOKEN : undefined;
  },
  boardSnapshot: async () => ({
    property: { name: "Home place", lat: 33.05, lon: -97.44, timezone: "America/Chicago" },
    date: "2026-11-16",
    chores: [],
    sitter: { contacts: [], notes: [] },
  }),
  tickBoardChore: async (_token: unknown, id: string, done: boolean) => {
    state.ticks.push({ id, done });
    return state.tick;
  },
}));

const { GET } = await import("../app/api/board/v1/route.js");
const { POST } = await import("../app/api/board/v1/chores/[id]/route.js");

const get = (headers: Record<string, string> = { Authorization: "Bearer gfapp_x" }) =>
  GET(new Request("https://farm.example/api/board/v1", { headers }));

const post = (id: string, body: unknown, headers = { Authorization: "Bearer gfapp_x" }) =>
  POST(
    new Request(`https://farm.example/api/board/v1/chores/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: encodeURIComponent(id) }) },
  );

beforeEach(() => {
  state.authorized = true;
  state.authFails = false;
  state.tick = { kind: "ticked", done: true };
  state.ticks = [];
  state.headers = [];
});

describe("GET /api/board/v1", () => {
  it("answers the board for a good token, uncached", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ date: "2026-11-16", chores: [] });
    expect(state.headers).toEqual(["Bearer gfapp_x"]);
  });

  it("refuses anything else with the contract's 401", async () => {
    state.authorized = false;
    const response = await get({});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("says unavailable, not unauthorized, when the database is down", async () => {
    state.authFails = true;
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});

describe("POST /api/board/v1/chores/{id}", () => {
  const id = "occurrence:01ARZ3NDEKTSV4RRFFQ69G5FT1:2026-11-16";

  it("ticks, decoding the id, and answers the contract's body", async () => {
    const response = await post(id, { done: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, done: true });
    expect(state.ticks).toEqual([{ id, done: true }]);
  });

  it("refuses an unauthorised caller before reading anything", async () => {
    state.authorized = false;
    const response = await post(id, { done: true });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(state.ticks).toEqual([]);
  });

  it("answers 404 for an id the farm does not know", async () => {
    state.tick = { kind: "not_found" };
    const response = await post("nonsense", { done: false });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it.each([["not json"], [{}], [{ done: "yes" }], [null]])("refuses a body of %j", async (body) => {
    const response = await post(id, body);
    expect(response.status).toBe(400);
    expect(state.ticks).toEqual([]);
  });

  it("passes a refusal through as a 409 with the farm's reason", async () => {
    state.tick = { kind: "refused", reason: "The farm refused that change." };
    const response = await post(id, { done: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "refused",
      detail: "The farm refused that change.",
    });
  });
});
