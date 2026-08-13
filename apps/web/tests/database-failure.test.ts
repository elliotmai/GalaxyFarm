import { describe, expect, it } from "vitest";

import { SCHEMA_CODES, classifyDatabaseFailure, sqlState } from "../lib/database-failure.js";
import { DeadlineExceededError } from "../lib/deadline.js";

/**
 * Which way the database failed (§4.2).
 *
 * Written because the first version of the People tab said "could not reach
 * the database" for all of these, and that sentence sends somebody to check
 * the network when the real answer was a migration that had not run yet.
 */

/** What postgres.js hands back: an Error carrying a SQLSTATE. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifying", () => {
  it("names a deploy that got ahead of its migration", () => {
    // 42703 undefined_column — the exact shape of publishing a build whose
    // queries name a column the migration has not added yet.
    const failure = classifyDatabaseFailure(
      pgError("42703", "column users.invite_token_hash does not exist"),
    );

    expect(failure.kind).toBe("schema-behind");
    expect(failure.retryable).toBe(true);
    expect(failure.message).toMatch(/migration/i);
  });

  it("names a missing table the same way", () => {
    expect(classifyDatabaseFailure(pgError("42P01", "relation users does not exist")).kind).toBe(
      "schema-behind",
    );
  });

  it("names a database that is asleep rather than broken", () => {
    const failure = classifyDatabaseFailure(new DeadlineExceededError("the people list", 8_000));

    expect(failure.kind).toBe("waking");
    expect(failure.retryable).toBe(true);
    expect(failure.message).toMatch(/try again/i);
  });

  it("names an app that was never given a connection string", () => {
    const failure = classifyDatabaseFailure(
      new Error("DATABASE_URL is not set. Copy .env.example"),
    );

    expect(failure.kind).toBe("not-configured");
    // Nothing to retry: reloading will not create a file.
    expect(failure.retryable).toBe(false);
    expect(failure.message).toMatch(/\.env\.local/);
  });

  it("falls back to saying what it actually got", () => {
    const failure = classifyDatabaseFailure(pgError("08006", "connect ECONNREFUSED 10.0.0.1:5432"));

    expect(failure.kind).toBe("unreachable");
    // The underlying message survives, because this is the case where nobody
    // can guess the next step and the detail is all there is to go on.
    expect(failure.message).toContain("ECONNREFUSED");
  });

  it("handles something that is not an Error at all", () => {
    expect(classifyDatabaseFailure("just a string").kind).toBe("unreachable");
    expect(classifyDatabaseFailure(undefined).kind).toBe("unreachable");
  });
});

describe("sqlState", () => {
  it("reads a five-character code and ignores anything else", () => {
    expect(sqlState(pgError("42703", "x"))).toBe("42703");
    expect(sqlState(new Error("no code"))).toBeUndefined();
    expect(sqlState({ code: "ECONNREFUSED" })).toBeUndefined();
    expect(sqlState({ code: 42703 })).toBeUndefined();
    expect(sqlState(null)).toBeUndefined();
  });

  it("knows the two codes a stale schema produces", () => {
    expect([...SCHEMA_CODES].sort()).toEqual(["42703", "42P01"].sort());
  });
});
