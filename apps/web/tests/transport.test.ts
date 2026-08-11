import { describe, expect, it, vi } from "vitest";

import type { OutboxEntry, Ulid } from "@galaxy-farm/core";

import { httpTransport, reviveRecord } from "../lib/local/transport.js";

/**
 * The device's half of the wire (spec §4.2).
 *
 * The same hazard as the server's half, in the other direction: a timestamp
 * that arrives as a string does not throw. It produces `NaN` comparisons, and
 * `NaN` loses every one of them — so a record pulled from the server would sort
 * wrong, page wrong, and merge wrong, with nothing anywhere saying so.
 */

const AT = "2026-11-15T08:00:00.000Z";

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("reviveRecord", () => {
  it("turns every timestamp back into a Date", () => {
    const record = reviveRecord({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      createdAt: AT,
      updatedAt: AT,
      dueAt: AT,
      listedDate: AT,
    });

    for (const field of ["createdAt", "updatedAt", "dueAt", "listedDate"] as const) {
      expect((record as unknown as Record<string, unknown>)[field], field).toBeInstanceOf(Date);
    }
  });

  it("recognises a timestamp by its name, not by a per-entity list", () => {
    // A list would be exact and would also be a list somebody forgets the day
    // they add `weanedAt`. Every timestamp column in the schema is `*At` or
    // `*Date`, so the naming is the contract.
    const record = reviveRecord({ id: "x", weanedAt: AT, targetDate: AT }) as unknown as Record<
      string,
      unknown
    >;

    expect(record["weanedAt"]).toBeInstanceOf(Date);
    expect(record["targetDate"]).toBeInstanceOf(Date);
  });

  it("leaves text that is not a timestamp alone", () => {
    const record = reviveRecord({ id: "x", name: "Andromeda", notes: AT }) as unknown as Record<
      string,
      unknown
    >;

    expect(record["name"]).toBe("Andromeda");
    // `notes` is not named like a date, so it stays a string even holding one.
    expect(record["notes"]).toBe(AT);
  });

  it("drops an unparseable timestamp rather than storing an Invalid Date", () => {
    // Absent is a state the code already handles everywhere. NaN is not — it
    // compares false against everything and silently loses.
    const record = reviveRecord({ id: "x", updatedAt: "soon" }) as unknown as Record<
      string,
      unknown
    >;

    expect(record["updatedAt"]).toBeUndefined();
  });

  it("turns null into an absent key, matching both repositories", () => {
    const record = reviveRecord({ id: "x", deletedAt: null, notes: null });

    expect("deletedAt" in record).toBe(false);
    expect("notes" in record).toBe(false);
  });

  it("keeps arrays and objects as they came", () => {
    const record = reviveRecord({
      id: "x",
      photoKeys: ["a", "b"],
      boundary: [{ lat: 33, lng: -97 }],
    }) as unknown as Record<string, unknown>;

    expect(record["photoKeys"]).toEqual(["a", "b"]);
    expect(record["boundary"]).toEqual([{ lat: 33, lng: -97 }]);
  });
});

describe("httpTransport", () => {
  const entry: OutboxEntry = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FE1" as Ulid,
    operation: "update",
    patch: {
      entity: "animals",
      recordId: "01ARZ3NDEKTSV4RRFFQ69G5FA1" as Ulid,
      changes: [{ field: "name", value: "Andy", at: new Date(AT), deviceId: "phone" }],
    },
    queuedAt: new Date(AT),
    deviceId: "phone",
    attempts: 0,
  };

  it("sends the outbox and returns what the server accepted", async () => {
    const fetch = vi.fn(async () =>
      response({ accepted: [entry.id], rejected: [], audit: [] }),
    ) as unknown as typeof globalThis.fetch;

    const result = await httpTransport({ fetch }).push([entry]);

    expect(result.accepted).toEqual([entry.id]);
  });

  it("throws on a server error, so the engine keeps the outbox and backs off", async () => {
    // Returning a failure instead would look like "the server considered this
    // and said no", and the entries would be dropped. A 500 is not a verdict.
    //
    // The status lives on the error rather than in its text: the message is
    // the server's own explanation, which is what a person needs to read.
    const fetch = vi.fn(async () =>
      response({ error: "boom" }, false, 500),
    ) as unknown as typeof globalThis.fetch;

    await expect(httpTransport({ fetch }).push([entry])).rejects.toMatchObject({
      status: 500,
      message: "boom",
    });
  });

  it("throws on a 401 too, rather than silently dropping a signed-out device's work", async () => {
    const fetch = vi.fn(async () =>
      response({ error: "Not signed in" }, false, 401),
    ) as unknown as typeof globalThis.fetch;

    await expect(httpTransport({ fetch }).pull({}, ["animals"])).rejects.toMatchObject({
      status: 401,
    });
  });

  it("revives every record in a pulled page", async () => {
    const fetch = vi.fn(async () =>
      response({
        pages: [
          {
            entity: "animals",
            hasMore: false,
            records: [{ id: "01ARZ3NDEKTSV4RRFFQ69G5FA1", updatedAt: AT, deletedAt: null }],
          },
        ],
      }),
    ) as unknown as typeof globalThis.fetch;

    const [page] = await httpTransport({ fetch }).pull({}, ["animals"]);

    expect(page?.records[0]?.updatedAt).toBeInstanceOf(Date);
    expect("deletedAt" in (page?.records[0] ?? {})).toBe(false);
  });

  it("carries hasMore through, so the engine knows to keep going", async () => {
    const fetch = vi.fn(async () =>
      response({ pages: [{ entity: "animals", hasMore: true, records: [] }] }),
    ) as unknown as typeof globalThis.fetch;

    const [page] = await httpTransport({ fetch }).pull({}, ["animals"]);

    expect(page?.hasMore).toBe(true);
  });

  it("copes with a response missing the fields it expects", async () => {
    // A proxy or a captive portal can return 200 with anything at all.
    const fetch = vi.fn(async () => response({})) as unknown as typeof globalThis.fetch;

    expect(await httpTransport({ fetch }).pull({}, ["animals"])).toEqual([]);
    expect((await httpTransport({ fetch }).push([entry])).accepted).toEqual([]);
  });
});
