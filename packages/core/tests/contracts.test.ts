import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CRUD_OPERATIONS,
  isCrudComplete,
  missingOperations,
  validate,
} from "../src/crud/contracts.js";

describe("CRUD completeness — spec §4.5 clause 1", () => {
  it("requires all five operations", () => {
    expect(CRUD_OPERATIONS).toEqual(["create", "get", "list", "update", "delete"]);
    expect(isCrudComplete({}, [...CRUD_OPERATIONS])).toBe(true);
  });

  it("fails an entity missing any operation", () => {
    expect(isCrudComplete({}, ["create", "get", "list", "update"])).toBe(false);
    expect(missingOperations(["create", "get", "list", "update"])).toEqual(["delete"]);
  });

  it("names every missing operation, not just the first", () => {
    expect(missingOperations(["create"])).toEqual(["get", "list", "update", "delete"]);
  });

  it("passes an entity on the enumerated exception list", () => {
    // §4.5 keeps this list closed: derived read models, immutable legal and
    // audit records, system-owned rows. Nothing else.
    const exempt = {
      exemption: { reason: "immutable-legal-record" as const, detail: "signed liability PDF" },
    };

    expect(isCrudComplete(exempt, ["create", "get"])).toBe(true);
  });
});

describe("boundary validation — spec §4.5 clause 2", () => {
  const schema = z.object({ name: z.string().min(1), count: z.number().int() });

  it("accepts valid input", () => {
    const result = validate(schema, { name: "hay", count: 4 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ name: "hay", count: 4 });
  });

  it("returns issues rather than throwing", () => {
    const result = validate(schema, { name: "", count: 1.5 });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("reports every field that failed, so a form can mark them all", () => {
    const result = validate(schema, { name: "", count: 1.5 });

    expect(!result.ok && result.error.kind === "validation" && result.error.issues).toHaveLength(2);
  });

  it("rejects entirely wrong shapes without throwing", () => {
    expect(validate(schema, null).ok).toBe(false);
    expect(validate(schema, "nope").ok).toBe(false);
    expect(validate(schema, undefined).ok).toBe(false);
  });
});
