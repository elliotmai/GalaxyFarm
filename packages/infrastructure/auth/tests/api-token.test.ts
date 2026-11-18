import { describe, expect, it } from "vitest";

import { API_TOKEN_PREFIX, bearerToken, hashApiToken, mintApiToken } from "../src/api-token.js";

/**
 * Connected-app tokens (spec §4.3). The token check is the whole of the
 * board API's authentication, so the parse is held to exactly what the
 * contract says: `Authorization: Bearer <token>` and nothing else.
 */

describe("mintApiToken", () => {
  it("returns a prefixed 256-bit token and its SHA-256 hash, never the same twice", () => {
    const minted = mintApiToken();
    expect(minted.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(minted.token).toHaveLength(API_TOKEN_PREFIX.length + 43);
    expect(minted.tokenHash).toBe(hashApiToken(minted.token));
    expect(minted.tokenHash).not.toContain(minted.token);

    const tokens = new Set(Array.from({ length: 200 }, () => mintApiToken().token));
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically, and differently per token", () => {
    expect(hashApiToken("gfapp_a")).toBe(hashApiToken("gfapp_a"));
    expect(hashApiToken("gfapp_a")).not.toBe(hashApiToken("gfapp_b"));
  });
});

describe("bearerToken", () => {
  const { token } = mintApiToken();

  it("reads a Bearer header", () => {
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBe(token);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["scheme only", "Bearer"],
    ["Basic", `Basic ${token}`],
    ["no scheme", token],
    ["two tokens", `Bearer ${token} ${token}`],
    ["not one of ours", "Bearer abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"],
    ["truncated", `Bearer ${token.slice(0, 20)}`],
    ["absurdly long", `Bearer ${token}${"x".repeat(200)}`],
  ])("refuses %s", (_label, header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});
