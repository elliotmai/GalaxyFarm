import { describe, expect, it, vi } from "vitest";

import { isServerError, SyncServerError } from "@galaxy-farm/core";

import { httpTransport } from "../lib/local/transport.js";

/**
 * Telling "no signal" apart from "the server said no" (spec §4.2).
 *
 * Written after a deploy went out ahead of its migrations. Every read is
 * local, so nothing on screen looked wrong; the sync badge said "Offline" in a
 * calm tone, which is the state everybody in a barn has learned to ignore, and
 * the only evidence was a 500 in a browser console. Work sat in outboxes for
 * as long as that lasted.
 *
 * Both cases still keep the outbox — nothing is ever lost either way. What
 * changed is that one of them is now reported as a fault.
 */

const respond = (status: number, body?: unknown) =>
  ({
    ok: status < 400,
    status,
    statusText: "",
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  }) as Response;

describe("httpTransport", () => {
  it("throws a server error carrying the status", async () => {
    const transport = httpTransport({
      fetch: vi.fn(async () => respond(500)) as never,
    });

    await expect(transport.pull({}, ["animals"])).rejects.toBeInstanceOf(SyncServerError);
    await expect(transport.pull({}, ["animals"])).rejects.toMatchObject({ status: 500 });
  });

  it("passes the server's own explanation through", async () => {
    // The point of the whole change: "Sync failed" is not actionable, and
    // "run pnpm db:migrate" is.
    const body = {
      error:
        "The database is behind this deploy — missing tables: feeding_plans. Run `pnpm db:migrate` against it.",
      kind: "schema-drift",
    };
    const transport = httpTransport({ fetch: vi.fn(async () => respond(503, body)) as never });

    await expect(transport.pull({}, ["animals"])).rejects.toThrow(/pnpm db:migrate/);
    await expect(transport.pull({}, ["animals"])).rejects.toMatchObject({ kind: "schema-drift" });
  });

  it("still throws usefully when the error body is not JSON", async () => {
    // A gateway timeout page is HTML, and the transport must not fail while
    // failing.
    const transport = httpTransport({ fetch: vi.fn(async () => respond(504)) as never });

    await expect(transport.pull({}, ["animals"])).rejects.toThrow(/504/);
  });

  it("distinguishes a refusal from an unreachable server", () => {
    // A thrown TypeError is what `fetch` gives for no signal, and it must not
    // be mistaken for the server answering.
    expect(isServerError(new SyncServerError(500, "boom"))).toBe(true);
    expect(isServerError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("reports a push failure the same way", async () => {
    const transport = httpTransport({
      fetch: vi.fn(async () =>
        respond(500, { error: "Sync push failed: relation does not exist" }),
      ) as never,
    });

    await expect(transport.push([])).rejects.toThrow(/relation does not exist/);
  });
});
