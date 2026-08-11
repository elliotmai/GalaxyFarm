import { describe, expect, it } from "vitest";

import { readText } from "../../tools/workspace.js";

/**
 * The spec is the source of truth (README says so). These tests keep the
 * non-negotiables from quietly disappearing out of it, and keep the README
 * honest about what the spec actually says.
 *
 * This is not documentation-for-its-own-sake: §4.5 and §4.1 are enforced by
 * executable checks elsewhere in this suite, and a check whose stated
 * justification has been deleted from the spec is a check nobody will
 * understand well enough to maintain.
 */

const spec = readText("docs/galaxy-farm-spec.md");
const readme = readText("README.md");

describe("spec §4.5 — the data operations contract survives", () => {
  it("has a section devoted to it", () => {
    expect(spec).toMatch(/### 4\.5 Data operations contract \(non-negotiable\)/);
  });

  it.each([
    ["full CRUD", /Full CRUD, everywhere it applies/],
    ["validation", /Validated input at every boundary/],
    ["confirmation", /Confirmation before every destructive action/],
    ["soft delete", /Soft delete, restore, and purge/],
  ])("still states clause: %s", (_label, pattern) => {
    expect(spec).toMatch(pattern);
  });

  it("keeps the exception list enumerated and closed", () => {
    // "Where applicable" is only meaningful if the exceptions are written down.
    expect(spec).toMatch(/Derived read models/);
    expect(spec).toMatch(/Immutable legal and audit records/);
    expect(spec).toMatch(/System-owned rows/);
    expect(spec).toMatch(/enumerated, closed, and small/);
  });

  it("keeps all three confirmation tiers", () => {
    for (const tier of ["Standard", "Elevated", "Typed"]) {
      expect(spec, `confirmation tier ${tier} is missing`).toContain(`| ${tier} |`);
    }
  });

  it("requires a declared delete behaviour on every relationship", () => {
    expect(spec).toMatch(/`restrict`/);
    expect(spec).toMatch(/`cascade`/);
    expect(spec).toMatch(/`detach`/);
  });

  it("is recorded in the decision log", () => {
    expect(spec).toMatch(/Data operations contract made non-negotiable/);
  });
});

describe("spec §11.1 — the quality gates are described as blocking", () => {
  it("has a quality gates section", () => {
    expect(spec).toMatch(/### 11\.1 Quality gates \(CI\)/);
  });

  it("names every gate the pipeline actually runs", () => {
    for (const gate of [
      "Lint",
      "Typecheck",
      "Architecture boundaries",
      "Route-map conformance",
      "Data-operations conformance",
      "Unit tests + coverage",
      "Build",
      "E2E",
    ]) {
      expect(spec, `gate "${gate}" is missing from §11.1`).toContain(gate);
    }
  });

  it("says the checks block", () => {
    expect(spec).toMatch(/every check blocks the merge/i);
  });
});

describe("README stays consistent with the spec", () => {
  it("carries the data operations contract", () => {
    expect(readme).toMatch(/## The data operations contract/);
    expect(readme).toMatch(/Non-negotiable, and enforced by CI/);
  });

  it("states all four clauses", () => {
    expect(readme).toMatch(/Full CRUD, everywhere it applies/);
    expect(readme).toMatch(/Validated input at every boundary/);
    expect(readme).toMatch(/Confirmation before every destructive action/);
    expect(readme).toMatch(/Soft delete, restore, purge/);
  });

  it("points at the spec section rather than restating it as a second source of truth", () => {
    expect(readme).toMatch(/§4\.5/);
  });

  it("does not claim the app is further along than it is", () => {
    // A README that oversells is worse than no README. When the placeholder
    // component is finally deleted, this test should be updated deliberately.
    expect(readme).toMatch(/## Current state/);
  });
});

describe("the spec's own numbering stays intact", () => {
  it.each([
    "## 1. Overview",
    "## 2. Guiding principles",
    "## 3. Stack",
    "## 4. System architecture",
    "## 5. Domain model",
    "## 6. Cross-cutting services",
    "## 7. Route map",
    "## 8. UI/UX notes",
    "## 9. Hosting & cost options",
    "## 10. Self-hosting migration path",
    "## 11. Build roadmap",
    "## 12. Decision log",
  ])("still has %s", (heading) => {
    expect(spec).toContain(heading);
  });
});
