import { describe, expect, it, vi } from "vitest";

import { isDroppedConnection, retryOnDroppedConnection } from "../src/reconnect.js";

const failure = (code: string) => Object.assign(new Error(code), { code });

describe("isDroppedConnection", () => {
  it.each(["CONNECTION_CLOSED", "CONNECTION_ENDED", "ECONNRESET", "EPIPE", "57P01", "08006"])(
    "recognises %s as a dead connection",
    (code) => expect(isDroppedConnection(failure(code))).toBe(true),
  );

  it.each(["42P01", "23505", "22P02"])("leaves %s alone — the query itself was wrong", (code) =>
    expect(isDroppedConnection(failure(code))).toBe(false),
  );

  it("is false for errors without a code", () => {
    expect(isDroppedConnection(new Error("boom"))).toBe(false);
    expect(isDroppedConnection(undefined)).toBe(false);
  });
});

describe("retryOnDroppedConnection", () => {
  it("retries once after a dropped connection", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(failure("CONNECTION_CLOSED"))
      .mockResolvedValueOnce("rows");

    await expect(retryOnDroppedConnection(read)).resolves.toBe("rows");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not retry any other failure", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(failure("42P01"));

    await expect(retryOnDroppedConnection(read)).rejects.toMatchObject({ code: "42P01" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second attempt", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(failure("ECONNRESET"));

    await expect(retryOnDroppedConnection(read)).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
