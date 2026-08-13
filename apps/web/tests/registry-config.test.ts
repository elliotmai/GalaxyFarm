import { describe, expect, it } from "vitest";

import { missingRegistrySettings } from "../lib/registry";

/**
 * Whether the catalogue is connected (spec §4.1).
 *
 * Not being connected is a real state rather than a fault — the crawl is an
 * optional extra and every other screen works without it. But "not connected"
 * and "you set three of the four" send somebody to completely different
 * places, and the second is by far the likelier once anybody has started, so
 * the answer names which ones are missing.
 */

const all = {
  NEO4J_URI: "neo4j+s://x.databases.neo4j.io",
  NEO4J_USERNAME: "x",
  NEO4J_PASSWORD: "secret",
  NEO4J_DATABASE: "x",
};

describe("what the catalogue is still waiting for", () => {
  it("is satisfied when all four are set", () => {
    expect(missingRegistrySettings(all)).toEqual([]);
  });

  it("names the one that was left out", () => {
    expect(missingRegistrySettings({ ...all, NEO4J_DATABASE: undefined })).toEqual([
      "NEO4J_DATABASE",
    ]);
  });

  it("counts a blank as missing", () => {
    // A variable declared and left empty is the ordinary way this goes wrong,
    // and it is indistinguishable from unset as far as connecting goes.
    expect(missingRegistrySettings({ ...all, NEO4J_PASSWORD: "   " })).toEqual(["NEO4J_PASSWORD"]);
  });

  it("names all four when nothing has been set", () => {
    expect(missingRegistrySettings({})).toEqual([
      "NEO4J_URI",
      "NEO4J_USERNAME",
      "NEO4J_PASSWORD",
      "NEO4J_DATABASE",
    ]);
  });
});
