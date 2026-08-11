import { describe, expect, it } from "vitest";

import { all, andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from "../src/types/result.js";

describe("Result", () => {
  it("carries a success value", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(result.ok && result.value).toBe(42);
  });

  it("carries a failure value", () => {
    const result = err("nope");
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    expect(!result.ok && result.error).toBe("nope");
  });

  it("maps a success and leaves a failure alone", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err<string>("bad"), (n: number) => n * 3)).toEqual(err("bad"));
  });

  it("maps an error and leaves a success alone", () => {
    expect(mapErr(err("bad"), (e) => e.toUpperCase())).toEqual(err("BAD"));
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
  });

  it("chains operations that may themselves fail", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("odd"));

    expect(andThen(ok(8), half)).toEqual(ok(4));
    expect(andThen(ok(7), half)).toEqual(err("odd"));
    expect(andThen(err<string>("earlier"), half)).toEqual(err("earlier"));
  });

  it("falls back on failure", () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err("bad"), 99)).toBe(99);
  });

  describe("all", () => {
    it("collects successes in order", () => {
      expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    });

    it("reports EVERY error, not just the first", () => {
      // A form that surfaces one problem at a time is a form people fill in
      // five times. This is the behaviour that stops that.
      const result = all([ok(1), err("a"), ok(2), err("b")]);

      expect(result).toEqual(err(["a", "b"]));
    });

    it("succeeds on an empty list", () => {
      expect(all([])).toEqual(ok([]));
    });
  });
});
