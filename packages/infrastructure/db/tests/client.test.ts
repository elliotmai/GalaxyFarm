import { describe, expect, it } from "vitest";

import { connectionConfig, describeConnection } from "../src/client.js";

/**
 * Connection settings, asserted without a database.
 *
 * These are the settings that pass every test and then fail in production —
 * prepared statements against a transaction-mode pooler, or a connect timeout
 * shorter than the cold start it has to survive.
 */

describe("connectionConfig", () => {
  it("disables prepared statements, which a transaction pooler cannot carry", () => {
    // Neon's pooled endpoint is PgBouncer in transaction mode: the connection
    // a prepared statement was created on is not the one the next query gets.
    expect(connectionConfig().prepare).toBe(false);
  });

  it("waits long enough for a scale-to-zero cold start", () => {
    // postgres.js defaults to 30s already, but the value is load-bearing here
    // rather than incidental — Neon takes about a second to wake, and a short
    // timeout would turn an idle database into a failed sync.
    expect(connectionConfig().connect_timeout).toBeGreaterThanOrEqual(10);
  });

  it("holds one connection per process by default", () => {
    // A serverless function gets its own process; a pool per invocation is how
    // a small farm exhausts a connection limit.
    expect(connectionConfig().max).toBe(1);
    expect(connectionConfig({ max: 10 }).max).toBe(10);
  });
});

describe("describeConnection", () => {
  it("reports where a run is pointed without exposing the password", () => {
    const described = describeConnection(
      "postgresql://user:hunter2@ep-example-123.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );

    expect(described).toEqual({
      host: "ep-example-123.us-east-2.aws.neon.tech",
      database: "neondb",
      pooled: false,
    });
    expect(JSON.stringify(described)).not.toContain("hunter2");
  });

  it("flags the pooled endpoint, which migrations should not use", () => {
    expect(
      describeConnection("postgresql://u:p@ep-example-123-pooler.us-east-2.aws.neon.tech/neondb")
        .pooled,
    ).toBe(true);
  });

  it("handles a plain local Postgres, which is where §10 ends up", () => {
    expect(describeConnection("postgresql://farm@192.168.1.20:5432/galaxy_farm")).toEqual({
      host: "192.168.1.20",
      database: "galaxy_farm",
      pooled: false,
    });
  });
});
