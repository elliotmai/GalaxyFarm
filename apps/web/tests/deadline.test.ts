import { describe, expect, it, vi } from "vitest";

import { DATABASE_DEADLINE_MS, DeadlineExceededError, withDeadline } from "../lib/deadline.js";

/**
 * Bounding a server-rendered database read (§4.2).
 *
 * Written after measuring it: against a database that was not answering, six
 * concurrent requests to the invitation page took 0.07s, 0.45s, 1.7s, 7.3s,
 * 18.5s and 31s, because the driver's connect timeout is thirty seconds and
 * the pool is one connection deep. The page already knew how to say "could not
 * reach it"; what it did not know was when to stop waiting to say so.
 */

describe("withDeadline", () => {
  it("passes the value straight through when the work is quick", async () => {
    await expect(withDeadline(Promise.resolve("here"), "a read")).resolves.toBe("here");
  });

  it("passes a failure through as itself", async () => {
    // A refused connection must not be reported as a timeout — the two need
    // different things done about them.
    const refused = new Error("connect ECONNREFUSED");

    await expect(withDeadline(Promise.reject(refused), "a read")).rejects.toBe(refused);
  });

  it("gives up once the deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<string>(() => {});
      const raced = withDeadline(never, "the people list", 8_000);
      const settled = expect(raced).rejects.toBeInstanceOf(DeadlineExceededError);

      await vi.advanceTimersByTimeAsync(8_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("names what did not answer, so the log says which read it was", async () => {
    vi.useFakeTimers();
    try {
      const raced = withDeadline(new Promise<string>(() => {}), "the invitation lookup", 100);
      const settled = expect(raced).rejects.toThrow(/the invitation lookup did not answer/);

      await vi.advanceTimersByTimeAsync(100);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave the abandoned work as an unhandled rejection", async () => {
    // The work rejects on its own schedule long after we stopped waiting, and
    // an unhandled rejection takes the whole server down rather than the page.
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);

    try {
      let fail: (error: Error) => void = () => {};
      const slow = new Promise<string>((_, reject) => {
        fail = reject;
      });

      await expect(withDeadline(slow, "a read", 1)).rejects.toBeInstanceOf(DeadlineExceededError);
      fail(new Error("connect ECONNREFUSED, eventually"));

      // A turn of the microtask queue and a macrotask, which is when Node
      // decides a rejection was unhandled.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("clears its timer, so a resolved read does not hold the process open", async () => {
    vi.useFakeTimers();
    try {
      const clear = vi.spyOn(globalThis, "clearTimeout");
      await withDeadline(Promise.resolve("here"), "a read");

      expect(clear).toHaveBeenCalled();
      clear.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults to a ceiling somebody would actually wait out", () => {
    expect(DATABASE_DEADLINE_MS).toBeLessThan(30_000);
    expect(DATABASE_DEADLINE_MS).toBeGreaterThan(2_000);
  });
});
